/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// UpdateQueue is a linked list of prioritized updates.
//
// Like fibers, update queues come in pairs: a current queue, which represents
// the visible state of the screen, and a work-in-progress queue, which can be
// mutated and processed asynchronously before it is committed — a form of
// double buffering. If a work-in-progress render is discarded before finishing,
// we create a new work-in-progress by cloning the current queue.
//
// Both queues share a persistent, singly-linked list structure. To schedule an
// update, we append it to the end of both queues. Each queue maintains a
// pointer to first update in the persistent list that hasn't been processed.
// The work-in-progress pointer always has a position equal to or greater than
// the current queue, since we always work on that one. The current queue's
// pointer is only updated during the commit phase, when we swap in the
// work-in-progress.
//
// For example:
//
//   Current pointer:           A - B - C - D - E - F
//   Work-in-progress pointer:              D - E - F
//                                          ^
//                                          The work-in-progress queue has
//                                          processed more updates than current.
//
// The reason we append to both queues is because otherwise we might drop
// updates without ever processing them. For example, if we only add updates to
// the work-in-progress queue, some updates could be lost whenever a work-in
// -progress render restarts by cloning from current. Similarly, if we only add
// updates to the current queue, the updates will be lost whenever an already
// in-progress queue commits and swaps with the current queue. However, by
// adding to both queues, we guarantee that the update will be part of the next
// work-in-progress. (And because the work-in-progress queue becomes the
// current queue once it commits, there's no danger of applying the same
// update twice.)
//
// Prioritization
// --------------
//
// Updates are not sorted by priority, but by insertion; new updates are always
// appended to the end of the list.
//
// The priority is still important, though. When processing the update queue
// during the render phase, only the updates with sufficient priority are
// included in the result. If we skip an update because it has insufficient
// priority, it remains in the queue to be processed later, during a lower
// priority render. Crucially, all updates subsequent to a skipped update also
// remain in the queue *regardless of their priority*. That means high priority
// updates are sometimes processed twice, at two separate priorities. We also
// keep track of a base state, that represents the state before the first
// update in the queue is applied.
//
// For example:
//
//   Given a base state of '', and the following queue of updates
//
//     A1 - B2 - C1 - D2
//
//   where the number indicates the priority, and the update is applied to the
//   previous state by appending a letter, React will process these updates as
//   two separate renders, one per distinct priority level:
//
//   First render, at priority 1:
//     Base state: ''
//     Updates: [A1, C1]
//     Result state: 'AC'
//
//   Second render, at priority 2:
//     Base state: 'A'            <-  The base state does not include C1,
//                                    because B2 was skipped.
//     Updates: [B2, C1, D2]      <-  C1 was rebased on top of B2
//     Result state: 'ABCD'
//
// Because we process updates in insertion order, and rebase high priority
// updates when preceding updates are skipped, the final result is deterministic
// regardless of priority. Intermediate state may vary according to system
// resources, but the final state is always the same.

import type {Fiber} from './ReactInternalTypes';
import type {Lanes, Lane} from './ReactFiberLane';

import {NoLane, NoLanes, isSubsetOfLanes, mergeLanes} from './ReactFiberLane';
import {
  enterDisallowedContextReadInDEV,
  exitDisallowedContextReadInDEV,
} from './ReactFiberNewContext.old';
import {Callback, ShouldCapture, DidCapture} from './ReactFiberFlags';

import {debugRenderPhaseSideEffectsForStrictMode} from 'shared/ReactFeatureFlags';

import {StrictMode} from './ReactTypeOfMode';
import {markSkippedUpdateLanes} from './ReactFiberWorkLoop.old';

import invariant from 'shared/invariant';

import {disableLogs, reenableLogs} from 'shared/ConsolePatchingDev';

export type Update<State> = {|
  // TODO: Temporary field. Will remove this by storing a map of
  // transition -> event time on the root.
  eventTime: number,
  lane: Lane,

  tag: 0 | 1 | 2 | 3,
  payload: any,
  callback: (() => mixed) | null,

  next: Update<State> | null,
|};

type SharedQueue<State> = {|
  pending: Update<State> | null,
|};

export type UpdateQueue<State> = {|
  baseState: State,
  firstBaseUpdate: Update<State> | null,
  lastBaseUpdate: Update<State> | null,
  shared: SharedQueue<State>,
  effects: Array<Update<State>> | null, // effect list
|};

export const UpdateState = 0; // 更新
export const ReplaceState = 1; // 替换
export const ForceUpdate = 2; // 强制更换
export const CaptureUpdate = 3; // 捕获性的更新

// Global state that is reset at the beginning of calling `processUpdateQueue`.
// It should only be read right after calling `processUpdateQueue`, via
// `checkHasForceUpdateAfterProcessing`.
let hasForceUpdate = false;

let didWarnUpdateInsideUpdate;
let currentlyProcessingQueue;
export let resetCurrentlyProcessingQueue;
if (__DEV__) {
  didWarnUpdateInsideUpdate = false;
  currentlyProcessingQueue = null;
  resetCurrentlyProcessingQueue = () => {
    currentlyProcessingQueue = null;
  };
}

// 初始化hostRootFiber的updateQueue
export function initializeUpdateQueue<State>(fiber: Fiber): void {
  const queue: UpdateQueue<State> = {
    // 应用更新后的state
    // 每次的更新都是在这个baseState基础上进行更新
    baseState: fiber.memoizedState,
    // 队列中的第一个update
    firstBaseUpdate: null,
    // 队列中的最后一个update
    lastBaseUpdate: null,
    shared: {
      // 新的baseQueue
      // setState会将需要更新的update对象存储在这里
      pending: null,
    },
    // effect list
    // commit的第三个阶段会取effects上的所有callback执行
    effects: null,
  };
  fiber.updateQueue = queue;
}

// 将currentFiber的updateQueue克隆到workInProgress.updateQueue上
export function cloneUpdateQueue<State>(
  current: Fiber,
  workInProgress: Fiber,
): void {
  // Clone the update queue from current. Unless it's already a clone.
  // workInProgress的updateQueue
  const queue: UpdateQueue<State> = (workInProgress.updateQueue: any);
  // current的updateQueue
  const currentQueue: UpdateQueue<State> = (current.updateQueue: any);
  // 将current的updateQueue克隆到workInProgress.updateQueue上
  // 两者相同，说明还没有克隆过
  if (queue === currentQueue) {
    const clone: UpdateQueue<State> = {
      baseState: currentQueue.baseState,
      firstBaseUpdate: currentQueue.firstBaseUpdate,
      lastBaseUpdate: currentQueue.lastBaseUpdate,
      shared: currentQueue.shared,
      effects: currentQueue.effects,
    };
    workInProgress.updateQueue = clone;
  }
}

// 创建tag为UpdateState的update对象，在更新state时会对state做更新合并
export function createUpdate(eventTime: number, lane: Lane): Update<*> {
  const update: Update<*> = {
    eventTime, // 程序运行到此刻的时间戳，React会基于它进行更新优先级排序
    lane, // 优先级泳道
    // export const UpdateState = 0; // 更新，在更新state时会对state做更新合并
    // export const ReplaceState = 1; // 替换，在更新state时会拿新state直接覆盖老state
    // export const ForceUpdate = 2; // 强制更换
    // export const CaptureUpdate = 3; // 捕获性的更新
    tag: UpdateState, // 默认为0
    // 更新内容，比如`setState`接收的第一个参数
    // 第一次渲染ReactDOM.render接收的是payload = {element};
    payload: null,
    // 更新完成后对应的回调，`setState`，`render`都有
    callback: null,
    // 指向下一个更新
    next: null,
  };
  return update;
}

// 将update放在fiber.updateQueue.shared.pending上，整个fiber.updateQueue.shared是个循环单链表
// enqueueUpdate是针对fiber链表的一个更新方法，将update task对象挂载到pending属性上
// 这里的fiber是workInProgress
export function enqueueUpdate<State>(fiber: Fiber, update: Update<State>) {
  const updateQueue = fiber.updateQueue;
  // 这种情况只有在fiber被卸载（unmounted）的情况下才会出现
  if (updateQueue === null) {
    // Only occurs if the fiber has been unmounted.
    return;
  }

  const sharedQueue: SharedQueue<State> = (updateQueue: any).shared;
  const pending = sharedQueue.pending;
  // 更新updateQueue.shared.pending链表，后续到 beginWork - processUpdateQueue 中会生成pendingUpdate链表并追加到baseUpdate链表末尾
  // 更新后的顺序为pending => update => pending.next => 循环
  // 然后sharedQueue.pending指向update，也就是原来的pending变成了最后一个
  // 会在 beginWork - processUpdateQueue 中将update.next设置为firstPendingUpdate，将update设置为lastPendingUpdate
  // 其实最后在pendingUpdate单链表中的顺序为pending.next => pending => update，也就是在末尾添加了update
  if (pending === null) {
    // This is the first update. Create a circular list.
    // 首次update，pending为null，update的next指向自身
    update.next = update;
  } else {
    // 更新update，update的next指向下一个pending的next
    // pending的next指向update
    // 更新后的顺序为pending => update => pending.next => 循环
    // 然后sharedQueue.pending指向update，也就是原来的pending变成了最后一个
    // 会在 beginWork - processUpdateQueue 中将update.next设置为firstPendingUpdate，将update设置为lastPendingUpdate
    // 其实最后在pendingUpdate单链表中的顺序为pending.next => pending => update，也就是在末尾添加了update
    update.next = pending.next;
    pending.next = update;
  }
  // 将update对象放在sharedQueue的pending上
  sharedQueue.pending = update;

  if (__DEV__) {
    if (
      currentlyProcessingQueue === sharedQueue &&
      !didWarnUpdateInsideUpdate
    ) {
      console.error(
        'An update (setState, replaceState, or forceUpdate) was scheduled ' +
          'from inside an update function. Update functions should be pure, ' +
          'with zero side-effects. Consider using componentDidUpdate or a ' +
          'callback.',
      );
      didWarnUpdateInsideUpdate = true;
    }
  }
}

export function enqueueCapturedUpdate<State>(
  workInProgress: Fiber,
  capturedUpdate: Update<State>,
) {
  // Captured updates are updates that are thrown by a child during the render
  // phase. They should be discarded if the render is aborted. Therefore,
  // we should only put them on the work-in-progress queue, not the current one.
  let queue: UpdateQueue<State> = (workInProgress.updateQueue: any);

  // Check if the work-in-progress queue is a clone.
  const current = workInProgress.alternate;
  if (current !== null) {
    const currentQueue: UpdateQueue<State> = (current.updateQueue: any);
    if (queue === currentQueue) {
      // The work-in-progress queue is the same as current. This happens when
      // we bail out on a parent fiber that then captures an error thrown by
      // a child. Since we want to append the update only to the work-in
      // -progress queue, we need to clone the updates. We usually clone during
      // processUpdateQueue, but that didn't happen in this case because we
      // skipped over the parent when we bailed out.
      let newFirst = null;
      let newLast = null;
      const firstBaseUpdate = queue.firstBaseUpdate;
      if (firstBaseUpdate !== null) {
        // Loop through the updates and clone them.
        let update = firstBaseUpdate;
        do {
          const clone: Update<State> = {
            eventTime: update.eventTime,
            lane: update.lane,

            tag: update.tag,
            payload: update.payload,
            callback: update.callback,

            next: null,
          };
          if (newLast === null) {
            newFirst = newLast = clone;
          } else {
            newLast.next = clone;
            newLast = clone;
          }
          update = update.next;
        } while (update !== null);

        // Append the captured update the end of the cloned list.
        if (newLast === null) {
          newFirst = newLast = capturedUpdate;
        } else {
          newLast.next = capturedUpdate;
          newLast = capturedUpdate;
        }
      } else {
        // There are no base updates.
        newFirst = newLast = capturedUpdate;
      }
      queue = {
        baseState: currentQueue.baseState,
        firstBaseUpdate: newFirst,
        lastBaseUpdate: newLast,
        shared: currentQueue.shared,
        effects: currentQueue.effects,
      };
      workInProgress.updateQueue = queue;
      return;
    }
  }

  // Append the update to the end of the list.
  const lastBaseUpdate = queue.lastBaseUpdate;
  if (lastBaseUpdate === null) {
    queue.firstBaseUpdate = capturedUpdate;
  } else {
    lastBaseUpdate.next = capturedUpdate;
  }
  queue.lastBaseUpdate = capturedUpdate;
}

// 更新state，这里的newState可能是合并之后的新state，也可能是直接做覆盖处理的新state，可能只是做了标记返回了老state
// setState传入的update的tag为UpdateState，这里会进行更新合并处理
function getStateFromUpdate<State>(
  workInProgress: Fiber,
  queue: UpdateQueue<State>, // workInProgress.updateQueue
  update: Update<State>, // 当前baseUpdate
  prevState: State, // workInProgress.updateQueue.baseState
  nextProps: any, // nextProps
  instance: any,
): any {
  switch (update.tag) {
    case ReplaceState: {
      // 替换
      // 根据payload生成新的state返回
      const payload = update.payload;
      if (typeof payload === 'function') {
        // Updater function
        if (__DEV__) {
          enterDisallowedContextReadInDEV();
        }
        const nextState = payload.call(instance, prevState, nextProps);
        if (__DEV__) {
          if (
            debugRenderPhaseSideEffectsForStrictMode &&
            workInProgress.mode & StrictMode
          ) {
            disableLogs();
            try {
              payload.call(instance, prevState, nextProps);
            } finally {
              reenableLogs();
            }
          }
          exitDisallowedContextReadInDEV();
        }
        return nextState;
      }
      // State object
      return payload;
    }
    case CaptureUpdate: {
      // 捕获
      // workInProgress副作用flags移除ShouldCapture，加上DidCapture
      workInProgress.flags =
        (workInProgress.flags & ~ShouldCapture) | DidCapture;
    }
    // Intentional fallthrough
    case UpdateState: {
      // 更新合并
      // 新的合并到老的上面
      const payload = update.payload;
      // 根据payload拿到部分新的state
      let partialState;
      if (typeof payload === 'function') {
        // Updater function
        if (__DEV__) {
          enterDisallowedContextReadInDEV();
        }
        partialState = payload.call(instance, prevState, nextProps);
        if (__DEV__) {
          if (
            debugRenderPhaseSideEffectsForStrictMode &&
            workInProgress.mode & StrictMode
          ) {
            disableLogs();
            try {
              payload.call(instance, prevState, nextProps);
            } finally {
              reenableLogs();
            }
          }
          exitDisallowedContextReadInDEV();
        }
      } else {
        // Partial state object
        partialState = payload;
      }
      // 将partialState合并到prevState上并返回
      if (partialState === null || partialState === undefined) {
        // Null and undefined are treated as no-ops.
        return prevState;
      }
      // Merge the partial state and the previous state.
      return Object.assign({}, prevState, partialState);
    }
    case ForceUpdate: {
      // 强制更新
      // 标记需要强制更新，直接返回老的state
      hasForceUpdate = true;
      return prevState;
    }
  }
  // 非以上情况，直接返回老的state
  return prevState;
}

// 将workInProgress.updateQueue.shared.pending链表追加到workInProgress.updateQueue的baseUpdate链表最后
// 然后根据baseUpdate链表，更新state，这里的newState可能是合并之后的新state，也可能是直接做覆盖处理的新state，可能只是做了标记返回了老state
// 如果update有callback，给workInProgress加上Callback副作用，会completeUnitOfWork时将自身添加到父workInProgress的effect list链表的最后
// 同时在workInProgress.updateQueue.effects中添加这个update对象，会在commit的第三阶段统一执行workInProgress.updateQueue.effects中的所有update对象的callback
// 最后更新相关属性，有两种情况
// 1.有newBaseUpdate链表
//     queue.baseState = queue.baseState(老state)
//     queue.firstBaseUpdate = newFirstBaseUpdate
//     queue.lastBaseUpdate = newLastBaseUpdate
//     workInProgress.lanes = updateLane
//     workInProgress.memoizedState = newState(新state)
// 2.没有newBaseUpdate链表
//     queue.baseState = newState(新state)
//     queue.firstBaseUpdate = null
//     queue.lastBaseUpdate = null
//     workInProgress.lanes = NoLanes
//     workInProgress.memoizedState = newState(新state)
export function processUpdateQueue<State>(
  workInProgress: Fiber,
  props: any, // nextProps
  instance: any, // null
  renderLanes: Lanes,
): void {
  // This is always non-null on a ClassComponent or HostRoot
  // 新克隆的updateQueue
  const queue: UpdateQueue<State> = (workInProgress.updateQueue: any);

  hasForceUpdate = false;

  if (__DEV__) {
    currentlyProcessingQueue = queue.shared;
  }

  let firstBaseUpdate = queue.firstBaseUpdate;
  let lastBaseUpdate = queue.lastBaseUpdate;

  // Check if there are pending updates. If so, transfer them to the base queue.
  // 将pendingQueue同步更新到workInProgress和currentFiber的baseQueue的最后
  // pendingQueue里面存放的是需要更新的内容，setState会生成一个新的update对象放在pendingQueue上
  // workInProgress.updateQueue未更新，在最后更新
  // 而currentFiber.updateQueue这里已经更新了
  let pendingQueue = queue.shared.pending;
  if (pendingQueue !== null) {
    // 有pendingQueue

    queue.shared.pending = null;

    // The pending queue is circular. Disconnect the pointer between first
    // and last so that it's non-circular.
    // pendingQueue是循环的，断开首尾的连接
    // queue.shared.pending.next作为firstPendingUpdate
    // queue.shared.pending作为lastPendingUpdate
    // setState中新添加的update对象是放在queue.shared.pending上，到这里也就成了lastPendingUpdate，也就是放在了更新队列的末尾
    const lastPendingUpdate = pendingQueue;
    const firstPendingUpdate = lastPendingUpdate.next;
    lastPendingUpdate.next = null;
    // Append pending updates to base queue
    // 将pendingQueue加在baseQueue的最后(没有baseQueue即从头开始加，也是加在最后)
    // 这里完成baseQueue的更新，但未更新到workInProgress.updateQueue上
    if (lastBaseUpdate === null) {
      firstBaseUpdate = firstPendingUpdate;
    } else {
      lastBaseUpdate.next = firstPendingUpdate;
    }
    lastBaseUpdate = lastPendingUpdate;

    // If there's a current queue, and it's different from the base queue, then
    // we need to transfer the updates to that queue, too. Because the base
    // queue is a singly-linked list with no cycles, we can append to both
    // lists and take advantage of structural sharing.
    // TODO: Pass `current` as argument
    // 同步pendingQueue到currentFiber的base Update的最后，实现结构共享
    // 这里直接更新到current.updateQueue上

    // currentFiber
    const current = workInProgress.alternate;
    if (current !== null) {
      // This is always non-null on a ClassComponent or HostRoot
      const currentQueue: UpdateQueue<State> = (current.updateQueue: any);
      const currentLastBaseUpdate = currentQueue.lastBaseUpdate;
      // currentLastBaseUpdate !== lastBaseUpdate 表示有pendingQueue，同步到currentQueue上
      if (currentLastBaseUpdate !== lastBaseUpdate) {
        if (currentLastBaseUpdate === null) {
          currentQueue.firstBaseUpdate = firstPendingUpdate;
        } else {
          currentLastBaseUpdate.next = firstPendingUpdate;
        }
        currentQueue.lastBaseUpdate = lastPendingUpdate;
      }
    }
  }

  // These values may change as we process the queue.
  if (firstBaseUpdate !== null) {
    // Iterate through the list of updates to compute the result.
    let newState = queue.baseState;
    // TODO: Don't need to accumulate this. Instead, we can remove renderLanes
    // from the original lanes.
    let newLanes = NoLanes;

    let newBaseState = null;
    let newFirstBaseUpdate = null;
    let newLastBaseUpdate = null;

    // 遍历workInProgress的新的baseQueue(包括加上的pendingQueue)
    // 更新state，这里的newState可能是合并之后的新state，也可能是直接做覆盖处理的新state，可能只是做了标记返回了老state
    // 如果update有callback，给workInProgress加上Callback副作用，会completeUnitOfWork时将自身添加到父workInProgress的effect list链表的最后
    // 同时在workInProgress.updateQueue.effects中添加这个update对象，会在commit的第三阶段统一执行workInProgress.updateQueue.effects中的所有update对象的callback
    // 这个过程中有可能会产生newFirstBaseUpdate和newLastBaseUpdate(后面统称newBaseUpdate链表)，什么情况下会产生呢???
    let update = firstBaseUpdate;
    do {
      // baseUpdate的lane
      const updateLane = update.lane;
      // baseUpdate的eventTime
      const updateEventTime = update.eventTime;
      if (!isSubsetOfLanes(renderLanes, updateLane)) {
        // Priority is insufficient. Skip this update. If this is the first
        // skipped update, the previous update/state is the new base
        // update/state.
        // renderLanes中没有updateLane，会产生newBaseUpdate链表，什么情况下会产生呢???

        // 根据update克隆一个新的update，更新为newLastBaseUpdate
        const clone: Update<State> = {
          eventTime: updateEventTime,
          lane: updateLane,

          tag: update.tag,
          payload: update.payload,
          callback: update.callback,

          next: null,
        };
        if (newLastBaseUpdate === null) {
          newFirstBaseUpdate = newLastBaseUpdate = clone;
          newBaseState = newState;
        } else {
          newLastBaseUpdate = newLastBaseUpdate.next = clone;
        }
        // Update the remaining priority in the queue.
        // 将updateLane添加到新的newLanes中
        newLanes = mergeLanes(newLanes, updateLane);
      } else {
        // This update does have sufficient priority.
        // renderLanes中有updateLane
        // 更新state，这里的newState可能是合并之后的新state，也可能是直接做覆盖处理的新state，可能只是做了标记返回了老state
        // 如果update有callback，给workInProgress加上Callback副作用，会completeUnitOfWork时将自身添加到父workInProgress的effect list链表的最后
        // 同时在workInProgress.updateQueue.effects中添加这个update对象，会在commit的第三阶段统一执行workInProgress.updateQueue.effects中的所有update对象的callback

        // newLastBaseUpdate更新为最新的克隆的update对象
        if (newLastBaseUpdate !== null) {
          // 根据update克隆一个新的update添加到新的baseQueue的最后
          const clone: Update<State> = {
            eventTime: updateEventTime,
            // This update is going to be committed so we never want uncommit
            // it. Using NoLane works because 0 is a subset of all bitmasks, so
            // this will never be skipped by the check above.
            // 这里设置lane为0，0是所有位掩码的子集，所以上面的isSubsetOfLanes永远为true，不会跳过
            lane: NoLane,

            tag: update.tag,
            payload: update.payload,
            callback: update.callback,

            next: null,
          };
          newLastBaseUpdate = newLastBaseUpdate.next = clone;
        }

        // Process this update.
        // 更新state，这里的newState可能是合并之后的新state，也可能是直接做覆盖处理的新state，可能只是做了标记返回了老state
        // setState传入的update的tag为UpdateState，这里会进行更新合并处理
        newState = getStateFromUpdate(
          workInProgress,
          queue,
          update,
          newState,
          props,
          instance,
        );
        // 如果update有callback，给workInProgress加上Callback副作用，会completeUnitOfWork时将自身添加到父workInProgress的effect list链表的最后
        // 同时在workInProgress.updateQueue.effects中添加这个update对象，会在commit的第三阶段统一执行workInProgress.updateQueue.effects中的所有update对象的callback
        const callback = update.callback;
        if (callback !== null) {
          workInProgress.flags |= Callback;
          const effects = queue.effects;
          if (effects === null) {
            queue.effects = [update];
          } else {
            effects.push(update);
          }
        }
      }
      // 下一个update
      update = update.next;

      // 没有下一个update，也就是baseQueue遍历完毕
      if (update === null) {
        // pending updates
        pendingQueue = queue.shared.pending;
        if (pendingQueue === null) {
          // 前面处理过，这里就为null，根据前面的逻辑这里只能是null
          break;
        } else {
          // An update was scheduled from inside a reducer. Add the new
          // pending updates to the end of the list and keep processing.
          
          // 根据前面的逻辑这里不可能执行到，这里处理什么情况???
          // 如果还有pendingQueue，加到baseQueue的最后，继续遍历

          const lastPendingUpdate = pendingQueue;
          // Intentionally unsound. Pending updates form a circular list, but we
          // unravel them when transferring them to the base queue.
          // 断开首尾的连接
          const firstPendingUpdate = ((lastPendingUpdate.next: any): Update<State>);
          lastPendingUpdate.next = null;
          update = firstPendingUpdate;
          queue.lastBaseUpdate = lastPendingUpdate;
          // 清空pending updates
          queue.shared.pending = null;
        }
      }
    } while (true);

    // 整个baseQueue链表处理完毕，如果没有newBaseUpdate链表，就将更新完成的newState赋值到newBaseState上
    if (newLastBaseUpdate === null) {
      newBaseState = newState;
    }

    // 下面有两种情况
    // 1.有newBaseUpdate链表
    //     queue.baseState = queue.baseState(老state)
    //     queue.firstBaseUpdate = newFirstBaseUpdate
    //     queue.lastBaseUpdate = newLastBaseUpdate
    //     workInProgress.lanes = updateLane
    //     workInProgress.memoizedState = newState(新state)
    // 2.没有newBaseUpdate链表
    //     queue.baseState = newState(新state)
    //     queue.firstBaseUpdate = null
    //     queue.lastBaseUpdate = null
    //     workInProgress.lanes = NoLanes
    //     workInProgress.memoizedState = newState(新state)

    // 更新workInProgress.updateQueue的baseState firstBaseUpdate lastBaseUpdate
    queue.baseState = ((newBaseState: any): State);
    queue.firstBaseUpdate = newFirstBaseUpdate;
    queue.lastBaseUpdate = newLastBaseUpdate;

    // Set the remaining expiration time to be whatever is remaining in the queue.
    // This should be fine because the only two other things that contribute to
    // expiration time are props and context. We're already in the middle of the
    // begin phase by the time we start processing the queue, so we've already
    // dealt with the props. Context in components that specify
    // shouldComponentUpdate is tricky; but we'll have to account for
    // that regardless.
    
    // 标记更新lanes跳过newLanes，更新workInProgress的lanes和memoizedState
    markSkippedUpdateLanes(newLanes);
    workInProgress.lanes = newLanes;
    workInProgress.memoizedState = newState;
  }

  if (__DEV__) {
    currentlyProcessingQueue = null;
  }
}

// 执行callback，传入context(nextEffect.stateNode)
function callCallback(callback, context) {
  invariant(
    typeof callback === 'function',
    'Invalid argument passed as callback. Expected a function. Instead ' +
      'received: %s',
    callback,
  );
  callback.call(context);
}

// hasForceUpdate重置为false
export function resetHasForceUpdateBeforeProcessing() {
  hasForceUpdate = false;
}

// 返回hasForceUpdate
export function checkHasForceUpdateAfterProcessing(): boolean {
  return hasForceUpdate;
}

// 提交updateQueue
// 遍历updateQueue，执行每一个effect的callback(effect.stateNode)
// 清空所有effect的callback和updateQueue
export function commitUpdateQueue<State>(
  finishedWork: Fiber, // nextEffect
  finishedQueue: UpdateQueue<State>, // nextEffect.updateQueue
  instance: any, // nextEffect.stateNode 
): void {
  // Commit the effects
  const effects = finishedQueue.effects;
  finishedQueue.effects = null;
  if (effects !== null) {
    for (let i = 0; i < effects.length; i++) {
      const effect = effects[i];
      const callback = effect.callback;
      if (callback !== null) {
        effect.callback = null;
        callCallback(callback, instance);
      }
    }
  }
}
