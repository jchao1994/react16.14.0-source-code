/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  Instance,
  TextInstance,
  SuspenseInstance,
  Container,
  ChildSet,
  UpdatePayload,
} from './ReactFiberHostConfig';
import type {Fiber} from './ReactInternalTypes';
import type {FiberRoot} from './ReactInternalTypes';
import type {Lanes} from './ReactFiberLane';
import type {SuspenseState} from './ReactFiberSuspenseComponent.old';
import type {UpdateQueue} from './ReactUpdateQueue.old';
import type {FunctionComponentUpdateQueue} from './ReactFiberHooks.old';
import type {Wakeable} from 'shared/ReactTypes';
import type {ReactPriorityLevel} from './ReactInternalTypes';
import type {OffscreenState} from './ReactFiberOffscreenComponent';

import {unstable_wrap as Schedule_tracing_wrap} from 'scheduler/tracing';
import {
  enableSchedulerTracing,
  enableProfilerTimer,
  enableProfilerCommitHooks,
  enableSuspenseServerRenderer,
  enableFundamentalAPI,
  enableSuspenseCallback,
  enableScopeAPI,
} from 'shared/ReactFeatureFlags';
import {
  FunctionComponent,
  ForwardRef,
  ClassComponent,
  HostRoot,
  HostComponent,
  HostText,
  HostPortal,
  Profiler,
  SuspenseComponent,
  DehydratedFragment,
  IncompleteClassComponent,
  MemoComponent,
  SimpleMemoComponent,
  SuspenseListComponent,
  FundamentalComponent,
  ScopeComponent,
  Block,
  OffscreenComponent,
  LegacyHiddenComponent,
} from './ReactWorkTags';
import {
  invokeGuardedCallback,
  hasCaughtError,
  clearCaughtError,
} from 'shared/ReactErrorUtils';
import {
  NoFlags,
  ContentReset,
  Placement,
  Snapshot,
  Update,
} from './ReactFiberFlags';
import getComponentName from 'shared/getComponentName';
import invariant from 'shared/invariant';

import {onCommitUnmount} from './ReactFiberDevToolsHook.old';
import {resolveDefaultProps} from './ReactFiberLazyComponent.old';
import {
  getCommitTime,
  recordLayoutEffectDuration,
  startLayoutEffectTimer,
} from './ReactProfilerTimer.old';
import {ProfileMode} from './ReactTypeOfMode';
import {commitUpdateQueue} from './ReactUpdateQueue.old';
import {
  getPublicInstance,
  supportsMutation,
  supportsPersistence,
  supportsHydration,
  commitMount,
  commitUpdate,
  resetTextContent,
  commitTextUpdate,
  appendChild,
  appendChildToContainer,
  insertBefore,
  insertInContainerBefore,
  removeChild,
  removeChildFromContainer,
  clearSuspenseBoundary,
  clearSuspenseBoundaryFromContainer,
  replaceContainerChildren,
  createContainerChildSet,
  hideInstance,
  hideTextInstance,
  unhideInstance,
  unhideTextInstance,
  unmountFundamentalComponent,
  updateFundamentalComponent,
  commitHydratedContainer,
  commitHydratedSuspenseInstance,
  clearContainer,
  prepareScopeUpdate,
} from './ReactFiberHostConfig';
import {
  captureCommitPhaseError,
  resolveRetryWakeable,
  markCommitTimeOfFallback,
  enqueuePendingPassiveHookEffectMount,
  enqueuePendingPassiveHookEffectUnmount,
  enqueuePendingPassiveProfilerEffect,
} from './ReactFiberWorkLoop.old';
import {
  NoFlags as NoHookEffect,
  HasEffect as HookHasEffect,
  Layout as HookLayout,
  Passive as HookPassive,
} from './ReactHookEffectTags';
import {didWarnAboutReassigningProps} from './ReactFiberBeginWork.old';

let didWarnAboutUndefinedSnapshotBeforeUpdate: Set<mixed> | null = null;
if (__DEV__) {
  didWarnAboutUndefinedSnapshotBeforeUpdate = new Set();
}

const PossiblyWeakSet = typeof WeakSet === 'function' ? WeakSet : Set;

// 更新props和state
// 调用componentWillUnmount方法，记录layout effect持续时间
const callComponentWillUnmountWithTimer = function (current, instance) {
  instance.props = current.memoizedProps;
  instance.state = current.memoizedState;
  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    current.mode & ProfileMode
  ) {
    try {
      startLayoutEffectTimer();
      // 执行instance的componentWillUnmount方法
      instance.componentWillUnmount();
    } finally {
      recordLayoutEffectDuration(current);
    }
  } else {
    // 执行instance的componentWillUnmount方法
    instance.componentWillUnmount();
  }
};

// Capture errors so they don't interrupt unmounting.
// 更新props和state
// 调用componentWillUnmount方法，记录layout effect持续时间
function safelyCallComponentWillUnmount(current: Fiber, instance: any) {
  if (__DEV__) {
    invokeGuardedCallback(
      null,
      callComponentWillUnmountWithTimer,
      null,
      current,
      instance,
    );
    if (hasCaughtError()) {
      const unmountError = clearCaughtError();
      captureCommitPhaseError(current, unmountError);
    }
  } else {
    try {
      callComponentWillUnmountWithTimer(current, instance);
    } catch (unmountError) {
      captureCommitPhaseError(current, unmountError);
    }
  }
}

// 重置ref.current为null或给ref回调传入null重置
// 记录layout effect持续时间
function safelyDetachRef(current: Fiber) {
  const ref = current.ref;
  if (ref !== null) {
    if (typeof ref === 'function') {
      if (__DEV__) {
        if (
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          current.mode & ProfileMode
        ) {
          startLayoutEffectTimer();
          invokeGuardedCallback(null, ref, null, null);
          recordLayoutEffectDuration(current);
        } else {
          invokeGuardedCallback(null, ref, null, null);
        }

        if (hasCaughtError()) {
          const refError = clearCaughtError();
          captureCommitPhaseError(current, refError);
        }
      } else {
        try {
          if (
            enableProfilerTimer &&
            enableProfilerCommitHooks &&
            current.mode & ProfileMode
          ) {
            try {
              startLayoutEffectTimer();
              ref(null);
            } finally {
              recordLayoutEffectDuration(current);
            }
          } else {
            ref(null);
          }
        } catch (refError) {
          captureCommitPhaseError(current, refError);
        }
      }
    } else {
      ref.current = null;
    }
  }
}

// 执行destroy方法
// destroy也就是useEffect的返回值函数
function safelyCallDestroy(current: Fiber, destroy: () => void) {
  if (__DEV__) {
    invokeGuardedCallback(null, destroy, null);
    if (hasCaughtError()) {
      const error = clearCaughtError();
      captureCommitPhaseError(current, error);
    }
  } else {
    try {
      destroy();
    } catch (error) {
      captureCommitPhaseError(current, error);
    }
  }
}

// 提交before mutation生命周期
function commitBeforeMutationLifeCycles(
  current: Fiber | null, // nextEffect对应的currentFiber
  finishedWork: Fiber, // nextEffect
): void {
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent:
    case Block: {
      return;
    }
    case ClassComponent: {
      if (finishedWork.flags & Snapshot) {
        if (current !== null) {
          const prevProps = current.memoizedProps;
          const prevState = current.memoizedState;
          const instance = finishedWork.stateNode;
          // We could update instance props and state here,
          // but instead we rely on them being set during last render.
          // TODO: revisit this when we implement resuming.
          if (__DEV__) {
            if (
              finishedWork.type === finishedWork.elementType &&
              !didWarnAboutReassigningProps
            ) {
              if (instance.props !== finishedWork.memoizedProps) {
                console.error(
                  'Expected %s props to match memoized props before ' +
                    'getSnapshotBeforeUpdate. ' +
                    'This might either be because of a bug in React, or because ' +
                    'a component reassigns its own `this.props`. ' +
                    'Please file an issue.',
                  getComponentName(finishedWork.type) || 'instance',
                );
              }
              if (instance.state !== finishedWork.memoizedState) {
                console.error(
                  'Expected %s state to match memoized state before ' +
                    'getSnapshotBeforeUpdate. ' +
                    'This might either be because of a bug in React, or because ' +
                    'a component reassigns its own `this.state`. ' +
                    'Please file an issue.',
                  getComponentName(finishedWork.type) || 'instance',
                );
              }
            }
          }
          const snapshot = instance.getSnapshotBeforeUpdate(
            finishedWork.elementType === finishedWork.type
              ? prevProps
              : resolveDefaultProps(finishedWork.type, prevProps),
            prevState,
          );
          if (__DEV__) {
            const didWarnSet = ((didWarnAboutUndefinedSnapshotBeforeUpdate: any): Set<mixed>);
            if (snapshot === undefined && !didWarnSet.has(finishedWork.type)) {
              didWarnSet.add(finishedWork.type);
              console.error(
                '%s.getSnapshotBeforeUpdate(): A snapshot value (or null) ' +
                  'must be returned. You have returned undefined.',
                getComponentName(finishedWork.type),
              );
            }
          }
          instance.__reactInternalSnapshotBeforeUpdate = snapshot;
        }
      }
      return;
    }
    case HostRoot: {
      if (supportsMutation) {
        if (finishedWork.flags & Snapshot) {
          const root = finishedWork.stateNode;
          clearContainer(root.containerInfo);
        }
      }
      return;
    }
    case HostComponent:
    case HostText:
    case HostPortal:
    case IncompleteClassComponent:
      // Nothing to do for these component types
      return;
  }
  invariant(
    false,
    'This unit of work tag should not have side-effects. This error is ' +
      'likely caused by a bug in React. Please file an issue.',
  );
}

// tag  HookLayout | HookHasEffect，表示useLayoutEffect
// 将finishedWork.updateQueue.lastEffect之后的effect都执行destroy
// 这里处理的是useLayoutEffect
function commitHookEffectListUnmount(tag: number, finishedWork: Fiber) {
  const updateQueue: FunctionComponentUpdateQueue | null = (finishedWork.updateQueue: any);
  const lastEffect = updateQueue !== null ? updateQueue.lastEffect : null;
  if (lastEffect !== null) {
    const firstEffect = lastEffect.next;
    let effect = firstEffect;
    // 将lastEffect之后的effect都执行destroy
    do {
      if ((effect.tag & tag) === tag) {
        // Unmount
        // 执行effect.destroy方法，并将其清空
        const destroy = effect.destroy;
        effect.destroy = undefined;
        if (destroy !== undefined) {
          destroy();
        }
      }
      effect = effect.next;
    } while (effect !== firstEffect);
  }
}

// tag 为 HookLayout | HookHasEffect，表示useLayoutEffect
// 处理hook useLayoutEffect，执行副作用回调
// finishedWork.updateQueue上存放着带useLayoutEffect的副作用回调的effect对象
// effect.create就是副作用回调，create()的返回值函数作为destroy，在卸载组件时调用
// 遍历updateQueue，effect.destroy赋值为effect.create()的执行结果
// 这里处理的是useLayoutEffect
function commitHookEffectListMount(tag: number, finishedWork: Fiber) {
  const updateQueue: FunctionComponentUpdateQueue | null = (finishedWork.updateQueue: any);
  const lastEffect = updateQueue !== null ? updateQueue.lastEffect : null;
  if (lastEffect !== null) {
    const firstEffect = lastEffect.next;
    let effect = firstEffect;
    do {
      // 这里的tag为 HookLayout(0b010) | HookHasEffect(0b001)，也就是0b011，表示useLayoutEffect
      // 只有当effect.tag的后两位均为1时，才会执行副作用函数，也就是useLayoutEffect
      if ((effect.tag & tag) === tag) {
        // Mount
        const create = effect.create;
        effect.destroy = create();

        if (__DEV__) {
          const destroy = effect.destroy;
          if (destroy !== undefined && typeof destroy !== 'function') {
            let addendum;
            if (destroy === null) {
              addendum =
                ' You returned null. If your effect does not require clean ' +
                'up, return undefined (or nothing).';
            } else if (typeof destroy.then === 'function') {
              addendum =
                '\n\nIt looks like you wrote useEffect(async () => ...) or returned a Promise. ' +
                'Instead, write the async function inside your effect ' +
                'and call it immediately:\n\n' +
                'useEffect(() => {\n' +
                '  async function fetchData() {\n' +
                '    // You can await here\n' +
                '    const response = await MyAPI.getData(someId);\n' +
                '    // ...\n' +
                '  }\n' +
                '  fetchData();\n' +
                `}, [someId]); // Or [] if effect doesn't need props or state\n\n` +
                'Learn more about data fetching with Hooks: https://reactjs.org/link/hooks-data-fetching';
            } else {
              addendum = ' You returned: ' + destroy;
            }
            console.error(
              'An effect function must not return anything besides a function, ' +
                'which is used for clean-up.%s',
              addendum,
            );
          }
        }
      }
      effect = effect.next;
    } while (effect !== firstEffect);
  }
}

function schedulePassiveEffects(finishedWork: Fiber) {
  const updateQueue: FunctionComponentUpdateQueue | null = (finishedWork.updateQueue: any);
  const lastEffect = updateQueue !== null ? updateQueue.lastEffect : null;
  if (lastEffect !== null) {
    const firstEffect = lastEffect.next;
    let effect = firstEffect;
    do {
      const {next, tag} = effect;
      if (
        (tag & HookPassive) !== NoHookEffect &&
        (tag & HookHasEffect) !== NoHookEffect
      ) {
        enqueuePendingPassiveHookEffectUnmount(finishedWork, effect);
        enqueuePendingPassiveHookEffectMount(finishedWork, effect);
      }
      effect = next;
    } while (effect !== firstEffect);
  }
}

export function commitPassiveEffectDurations(
  finishedRoot: FiberRoot,
  finishedWork: Fiber,
): void {
  if (enableProfilerTimer && enableProfilerCommitHooks) {
    // Only Profilers with work in their subtree will have an Update effect scheduled.
    if ((finishedWork.flags & Update) !== NoFlags) {
      switch (finishedWork.tag) {
        case Profiler: {
          const {passiveEffectDuration} = finishedWork.stateNode;
          const {id, onPostCommit} = finishedWork.memoizedProps;

          // This value will still reflect the previous commit phase.
          // It does not get reset until the start of the next commit phase.
          const commitTime = getCommitTime();

          if (typeof onPostCommit === 'function') {
            if (enableSchedulerTracing) {
              onPostCommit(
                id,
                finishedWork.alternate === null ? 'mount' : 'update',
                passiveEffectDuration,
                commitTime,
                finishedRoot.memoizedInteractions,
              );
            } else {
              onPostCommit(
                id,
                finishedWork.alternate === null ? 'mount' : 'update',
                passiveEffectDuration,
                commitTime,
              );
            }
          }

          // Bubble times to the next nearest ancestor Profiler.
          // After we process that Profiler, we'll bubble further up.
          let parentFiber = finishedWork.return;
          while (parentFiber !== null) {
            if (parentFiber.tag === Profiler) {
              const parentStateNode = parentFiber.stateNode;
              parentStateNode.passiveEffectDuration += passiveEffectDuration;
              break;
            }
            parentFiber = parentFiber.return;
          }
          break;
        }
        default:
          break;
      }
    }
  }
}

// 提交生命周期
// FunctionComponent  执行useLayoutEffect副作用回调，将返回值函数作为destroy，在卸载组件时调用destroy
// ClassComponent  触发componentDidMount或componentDidUpdate，清空updateQueue以其所有effect的callback
// HostRoot  处理子child，清空updateQueue以其所有effect的callback
// HostComponent  触发自动聚焦autoFocus
function commitLifeCycles(
  finishedRoot: FiberRoot,
  current: Fiber | null, // nextEffect对应的currentFiber
  finishedWork: Fiber, // nextEffect
  committedLanes: Lanes,
): void {
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent:
    case Block: {
      // At this point layout effects have already been destroyed (during mutation phase).
      // This is done to prevent sibling component effects from interfering with each other,
      // e.g. a destroy function in one component should never override a ref set
      // by a create function in another component during the same commit.
      if (
        enableProfilerTimer &&
        enableProfilerCommitHooks &&
        finishedWork.mode & ProfileMode
      ) {
        try {
          startLayoutEffectTimer();
          // tag 为 HookLayout | HookHasEffect，表示useLayoutEffect
          // 处理hook useLayoutEffect，执行副作用回调
          // finishedWork.updateQueue上存放着带useLayoutEffect的副作用回调的effect对象
          // effect.create就是副作用回调，create()的返回值函数作为destroy，在卸载组件时调用
          // 遍历updateQueue，effect.destroy赋值为effect.create()的执行结果
          // 这里处理的是useLayoutEffect
          commitHookEffectListMount(HookLayout | HookHasEffect, finishedWork);
        } finally {
          recordLayoutEffectDuration(finishedWork);
        }
      } else {
        // 遍历updateQueue，effect.destroy赋值为effect.create()的执行结果
        commitHookEffectListMount(HookLayout | HookHasEffect, finishedWork);
      }

      schedulePassiveEffects(finishedWork);
      return;
    }
    case ClassComponent: {
      // 类组件
      // 触发componentDidMount或componentDidUpdate
      // 清空updateQueue以其所有effect的callback

      // finishedWork对应的dom
      const instance = finishedWork.stateNode;
      // 处理update副作用，在第二阶段不是都处理过且移除了吗???
      // 触发用户传入的componentDidMount或componentDidUpdate生命周期，记录layout effect持续时间
      if (finishedWork.flags & Update) {
        if (current === null) {
          // 没有currentFiber，说明是首次渲染，触发用户传入的componentDidMount生命周期

          // We could update instance props and state here,
          // but instead we rely on them being set during last render.
          // TODO: revisit this when we implement resuming.
          // 这里更新instance的props和state，这里依赖上一次render的结果

          if (__DEV__) {
            if (
              finishedWork.type === finishedWork.elementType &&
              !didWarnAboutReassigningProps
            ) {
              if (instance.props !== finishedWork.memoizedProps) {
                console.error(
                  'Expected %s props to match memoized props before ' +
                    'componentDidMount. ' +
                    'This might either be because of a bug in React, or because ' +
                    'a component reassigns its own `this.props`. ' +
                    'Please file an issue.',
                  getComponentName(finishedWork.type) || 'instance',
                );
              }
              if (instance.state !== finishedWork.memoizedState) {
                console.error(
                  'Expected %s state to match memoized state before ' +
                    'componentDidMount. ' +
                    'This might either be because of a bug in React, or because ' +
                    'a component reassigns its own `this.state`. ' +
                    'Please file an issue.',
                  getComponentName(finishedWork.type) || 'instance',
                );
              }
            }
          }
          // 触发用户传入的componentDidMount生命周期，记录layout effect持续时间
          if (
            enableProfilerTimer &&
            enableProfilerCommitHooks &&
            finishedWork.mode & ProfileMode
          ) {
            try {
              // 记录layout effect开始时间
              startLayoutEffectTimer();
              // 触发用户传入的componentDidMount生命周期
              instance.componentDidMount();
            } finally {
              // 记录layout effect持续时间
              recordLayoutEffectDuration(finishedWork);
            }
          } else {
            // 触发用户传入的componentDidMount生命周期
            instance.componentDidMount();
          }iber
        } else {
          // 有currentFiber，说明是更新渲染，触发用户传入的componentDidUpdate生命周期

          // 获取老props
          const prevProps =
            finishedWork.elementType === finishedWork.type
              ? current.memoizedProps
              // 将defaultProps加入老props
              : resolveDefaultProps(finishedWork.type, current.memoizedProps);
          // 获取老state
          const prevState = current.memoizedState;
          // We could update instance props and state here,
          // but instead we rely on them being set during last render.
          // TODO: revisit this when we implement resuming.
          // 这里更新instance的props和state，这里依赖上一次render的结果

          if (__DEV__) {
            if (
              finishedWork.type === finishedWork.elementType &&
              !didWarnAboutReassigningProps
            ) {
              if (instance.props !== finishedWork.memoizedProps) {
                console.error(
                  'Expected %s props to match memoized props before ' +
                    'componentDidUpdate. ' +
                    'This might either be because of a bug in React, or because ' +
                    'a component reassigns its own `this.props`. ' +
                    'Please file an issue.',
                  getComponentName(finishedWork.type) || 'instance',
                );
              }
              if (instance.state !== finishedWork.memoizedState) {
                console.error(
                  'Expected %s state to match memoized state before ' +
                    'componentDidUpdate. ' +
                    'This might either be because of a bug in React, or because ' +
                    'a component reassigns its own `this.state`. ' +
                    'Please file an issue.',
                  getComponentName(finishedWork.type) || 'instance',
                );
              }
            }
          }
          // 触发用户传入的componentDidUpdate生命周期，记录layout effect持续时间
          if (
            enableProfilerTimer &&
            enableProfilerCommitHooks &&
            finishedWork.mode & ProfileMode
          ) {
            try {
              // 记录layout effect开始时间
              startLayoutEffectTimer();
              // 用户传入的componentDidUpdate生命周期
              instance.componentDidUpdate(
                prevProps,
                prevState,
                instance.__reactInternalSnapshotBeforeUpdate,
              );
            } finally {
              // 记录layout effect持续时间
              recordLayoutEffectDuration(finishedWork);
            }
          } else {
            // 触发用户传入的componentDidUpdate生命周期
            instance.componentDidUpdate(
              prevProps,
              prevState,
              instance.__reactInternalSnapshotBeforeUpdate,
            );
          }
        }
      }

      // TODO: I think this is now always non-null by the time it reaches the
      // commit phase. Consider removing the type check.
      // 这里总是非空的，可以考虑移除类型检查

      const updateQueue: UpdateQueue<
        *,
      > | null = (finishedWork.updateQueue: any);
      if (updateQueue !== null) {
        if (__DEV__) {
          if (
            finishedWork.type === finishedWork.elementType &&
            !didWarnAboutReassigningProps
          ) {
            if (instance.props !== finishedWork.memoizedProps) {
              console.error(
                'Expected %s props to match memoized props before ' +
                  'processing the update queue. ' +
                  'This might either be because of a bug in React, or because ' +
                  'a component reassigns its own `this.props`. ' +
                  'Please file an issue.',
                getComponentName(finishedWork.type) || 'instance',
              );
            }
            if (instance.state !== finishedWork.memoizedState) {
              console.error(
                'Expected %s state to match memoized state before ' +
                  'processing the update queue. ' +
                  'This might either be because of a bug in React, or because ' +
                  'a component reassigns its own `this.state`. ' +
                  'Please file an issue.',
                getComponentName(finishedWork.type) || 'instance',
              );
            }
          }
        }
        // We could update instance props and state here,
        // but instead we rely on them being set during last render.
        // TODO: revisit this when we implement resuming.
        // 这里更新instance的props和state，这里依赖上一次render的结果

        // 提交updateQueue
        // 遍历updateQueue，执行每一个effect的callback(effect.stateNode)
        // 清空所有effect的callback和updateQueue
        commitUpdateQueue(finishedWork, updateQueue, instance);
      }
      return;
    }
    case HostRoot: {
      // 根root，处理其子child
      // 清空updateQueue以其所有effect的callback

      // TODO: I think this is now always non-null by the time it reaches the
      // commit phase. Consider removing the type check.
      const updateQueue: UpdateQueue<
        *,
      > | null = (finishedWork.updateQueue: any);
      if (updateQueue !== null) {
        let instance = null;
        if (finishedWork.child !== null) {
          // 拿到finishedWork.child对应的dom instance
          switch (finishedWork.child.tag) {
            case HostComponent:
              instance = getPublicInstance(finishedWork.child.stateNode);
              break;
            case ClassComponent:
              instance = finishedWork.child.stateNode;
              break;
          }
        }
        // 提交updateQueue
        // 遍历updateQueue，执行每一个effect的callback(effect.stateNode)
        // 清空所有effect的callback和updateQueue
        commitUpdateQueue(finishedWork, updateQueue, instance);
      }
      return;
    }
    case HostComponent: {
      // 原生dom组件，触发自动聚焦autoFocus
      const instance: Instance = finishedWork.stateNode;

      // Renderers may schedule work to be done after host components are mounted
      // (eg DOM renderer may schedule auto-focus for inputs and form controls).
      // These effects should only be committed when components are first mounted,
      // aka when there is no current/alternate.
      
      // mounted之后需要调度一些工作，比如auto-focus，此时没有current/alternate
      if (current === null && finishedWork.flags & Update) {
        const type = finishedWork.type;
        const props = finishedWork.memoizedProps;
        // 触发自动聚焦autoFocus
        commitMount(instance, type, props, finishedWork);
      }

      return;
    }
    case HostText: {
      // We have no life-cycles associated with text.
      // 文本组件，这里没有生命周期
      return;
    }
    case HostPortal: {
      // We have no life-cycles associated with portals.
      return;
    }
    case Profiler: {
      if (enableProfilerTimer) {
        const {onCommit, onRender} = finishedWork.memoizedProps;
        const {effectDuration} = finishedWork.stateNode;

        const commitTime = getCommitTime();

        if (typeof onRender === 'function') {
          if (enableSchedulerTracing) {
            onRender(
              finishedWork.memoizedProps.id,
              current === null ? 'mount' : 'update',
              finishedWork.actualDuration,
              finishedWork.treeBaseDuration,
              finishedWork.actualStartTime,
              commitTime,
              finishedRoot.memoizedInteractions,
            );
          } else {
            onRender(
              finishedWork.memoizedProps.id,
              current === null ? 'mount' : 'update',
              finishedWork.actualDuration,
              finishedWork.treeBaseDuration,
              finishedWork.actualStartTime,
              commitTime,
            );
          }
        }

        if (enableProfilerCommitHooks) {
          if (typeof onCommit === 'function') {
            if (enableSchedulerTracing) {
              onCommit(
                finishedWork.memoizedProps.id,
                current === null ? 'mount' : 'update',
                effectDuration,
                commitTime,
                finishedRoot.memoizedInteractions,
              );
            } else {
              onCommit(
                finishedWork.memoizedProps.id,
                current === null ? 'mount' : 'update',
                effectDuration,
                commitTime,
              );
            }
          }

          // Schedule a passive effect for this Profiler to call onPostCommit hooks.
          // This effect should be scheduled even if there is no onPostCommit callback for this Profiler,
          // because the effect is also where times bubble to parent Profilers.
          enqueuePendingPassiveProfilerEffect(finishedWork);

          // Propagate layout effect durations to the next nearest Profiler ancestor.
          // Do not reset these values until the next render so DevTools has a chance to read them first.
          let parentFiber = finishedWork.return;
          while (parentFiber !== null) {
            if (parentFiber.tag === Profiler) {
              const parentStateNode = parentFiber.stateNode;
              parentStateNode.effectDuration += effectDuration;
              break;
            }
            parentFiber = parentFiber.return;
          }
        }
      }
      return;
    }
    case SuspenseComponent: {
      commitSuspenseHydrationCallbacks(finishedRoot, finishedWork);
      return;
    }
    case SuspenseListComponent:
    case IncompleteClassComponent:
    case FundamentalComponent:
    case ScopeComponent:
    case OffscreenComponent:
    case LegacyHiddenComponent:
      return;
  }
  invariant(
    false,
    'This unit of work tag should not have side-effects. This error is ' +
      'likely caused by a bug in React. Please file an issue.',
  );
}

// 递归finishedWork及其所有children，进行显示或隐藏操作(修改display)
function hideOrUnhideAllChildren(finishedWork, isHidden) {
  if (supportsMutation) {
    // We only have the top Fiber that was inserted but we need to recurse down its
    // children to find all the terminal nodes.
    let node: Fiber = finishedWork;
    // 递归finishedWork的所有children，进行显示或隐藏操作(修改display)
    while (true) {
      if (node.tag === HostComponent) {
        const instance = node.stateNode;
        if (isHidden) {
          // instance的display设为none，隐藏
          hideInstance(instance);
        } else {
          // 根据node.memoizedProps.style.display设置instance的display，显示
          unhideInstance(node.stateNode, node.memoizedProps);
        }
      } else if (node.tag === HostText) {
        const instance = node.stateNode;
        if (isHidden) {
          // 清空textInstance的文本，即为隐藏
          hideTextInstance(instance);
        } else {
          // 赋值textInstance的文本，即为显示
          unhideTextInstance(instance, node.memoizedProps);
        }
      } else if (
        (node.tag === OffscreenComponent ||
          node.tag === LegacyHiddenComponent) &&
        (node.memoizedState: OffscreenState) !== null &&
        node !== finishedWork
      ) {
        // Found a nested Offscreen component that is hidden. Don't search
        // any deeper. This tree should remain hidden.
      } else if (node.child !== null) {
        // 以上情况，不需要对child做处理，因为父dom的display可以控制child的显示与隐藏
        // 非以上情况，取node.child重复上述操作
        node.child.return = node;
        node = node.child;
        continue;
      }
      // 这里的情况是node.child === null

      // finishedWork.child === null，直接return
      if (node === finishedWork) {
        return;
      }
      // node.child === null 且 node不是finishedWork
      // 遍历其他sibling和return.sibling
      while (node.sibling === null) {
        if (node.return === null || node.return === finishedWork) {
          return;
        }
        node = node.return;
      }
      node.sibling.return = node.return;
      node = node.sibling;
    }
  }
}

// finishedWork  nextEffect
// ref.current指向为最新dom instance，或是给ref回调传入最新dom instance
function commitAttachRef(finishedWork: Fiber) {
  const ref = finishedWork.ref;
  if (ref !== null) {
    const instance = finishedWork.stateNode;
    let instanceToUse;
    // 根据tag获取可用的dom instance
    switch (finishedWork.tag) {
      case HostComponent:
        instanceToUse = getPublicInstance(instance);
        break;
      default:
        instanceToUse = instance;
    }
    // Moved outside to ensure DCE works with this flag
    if (enableScopeAPI && finishedWork.tag === ScopeComponent) {
      instanceToUse = instance;
    }
    if (typeof ref === 'function') {
      // ref回调函数
      // ref = { el => this.xxx = el }
      if (
        enableProfilerTimer &&
        enableProfilerCommitHooks &&
        finishedWork.mode & ProfileMode
      ) {
        try {
          // 记录layout effect开始时间
          startLayoutEffectTimer();
          // 给ref回调传入instanceToUse
          ref(instanceToUse);
        } finally {
          // 记录layout effect持续时间并添加到父fiber和祖先fiber的stateNode.effectDuration上
          recordLayoutEffectDuration(finishedWork);
        }
      } else {
        // 给ref回调传入instanceToUse
        ref(instanceToUse);
      }
    } else {
      if (__DEV__) {
        if (!ref.hasOwnProperty('current')) {
          console.error(
            'Unexpected ref object provided for %s. ' +
              'Use either a ref-setter function or React.createRef().',
            getComponentName(finishedWork.type),
          );
        }
      }

      // 设置ref.current为最新instanceToUse
      ref.current = instanceToUse;
    }
  }
}

// current  nextEffect对应的currentFiber
// 重置ref.current指向为null，或是给ref回调传入null重置
function commitDetachRef(current: Fiber) {
  const currentRef = current.ref;
  if (currentRef !== null) {
    if (typeof currentRef === 'function') {
      // ref是回调函数
      // ref = { el => this.xxx = el }
      if (
        enableProfilerTimer &&
        enableProfilerCommitHooks &&
        current.mode & ProfileMode
      ) {
        try {
          // 记录layout effect开始时间
          startLayoutEffectTimer();
          // 重置为null
          currentRef(null);
        } finally {
          // 记录layout effect持续时间并添加到父fiber和祖先fiber的stateNode.effectDuration上
          recordLayoutEffectDuration(current);
        }
      } else {
        // 重置为null
        currentRef(null);
      }
    } else {
      // 重置为null
      currentRef.current = null;
    }
  }
}

// User-originating errors (lifecycles and refs) should not interrupt
// deletion, so don't let them throw. Host-originating errors should
// interrupt deletion, so it's okay
// 用户发起的errors不应该删除，而host发起的errors应该删除

// 递归nextEffect及其所有children执行这个方法，提交卸载
// FunctionComponent 对需要删除的effect执行destroy方法，destroy也就是useEffect(异步调度)/useLayoutEffect(同步调度)的返回值函数
// ClassComponent 重置ref，调用用户传入的componentWillUnmount方法
// HostComponent 重置ref
// portal组件 重置container
function commitUnmount(
  finishedRoot: FiberRoot, // fiberRoot
  current: Fiber, // nextEffect及其所有children
  renderPriorityLevel: ReactPriorityLevel,
): void {
  // ???
  onCommitUnmount(current);

  switch (current.tag) {
    case FunctionComponent:
    case ForwardRef:
    case MemoComponent:
    case SimpleMemoComponent:
    case Block: {
      // 对current.updateQueue.lastEffect之后的所有effect执行destroy方法，记录layout effect持续时间
      // destroy也就是useEffect的返回值函数
      const updateQueue: FunctionComponentUpdateQueue | null = (current.updateQueue: any);
      if (updateQueue !== null) {
        const lastEffect = updateQueue.lastEffect;
        if (lastEffect !== null) {
          const firstEffect = lastEffect.next;

          let effect = firstEffect;
          // 对current.updateQueue.lastEffect之后的所有effect执行destroy方法，记录layout effect持续时间
          do {
            const {destroy, tag} = effect;
            if (destroy !== undefined) {
              if ((tag & HookPassive) !== NoHookEffect) {
                // useEffect 异步调度
                enqueuePendingPassiveHookEffectUnmount(current, effect);
              } else {
                // useLayoutEffect 同步调度
                if (
                  enableProfilerTimer &&
                  enableProfilerCommitHooks &&
                  current.mode & ProfileMode
                ) {
                  startLayoutEffectTimer();
                  // 执行destroy方法
                  // destroy也就是useEffect的返回值函数
                  safelyCallDestroy(current, destroy);
                  recordLayoutEffectDuration(current);
                } else {
                  safelyCallDestroy(current, destroy);
                }
              }
            }
            effect = effect.next;
          } while (effect !== firstEffect);
        }
      }
      return;
    }
    case ClassComponent: {
      // 重置ref.current为null或给ref回调传入null重置
      // 记录layout effect持续时间
      safelyDetachRef(current);
      const instance = current.stateNode;
      // 更新props和state
      // 调用componentWillUnmount方法，记录layout effect持续时间
      if (typeof instance.componentWillUnmount === 'function') {
        safelyCallComponentWillUnmount(current, instance);
      }
      return;
    }
    case HostComponent: {
      // 重置ref.current为null或给ref回调传入null重置
      // 记录layout effect持续时间
      safelyDetachRef(current);
      return;
    }
    case HostPortal: {
      // TODO: this is recursive.
      // We are also not using this parent because
      // the portal will get pushed immediately.
      if (supportsMutation) {
        // portal组件会递归调用unmountHostComponents
        unmountHostComponents(finishedRoot, current, renderPriorityLevel);
      } else if (supportsPersistence) {
        // 将portal组件的容器替换为空
        emptyPortalContainer(current);
      }
      return;
    }
    case FundamentalComponent: {
      if (enableFundamentalAPI) {
        const fundamentalInstance = current.stateNode;
        if (fundamentalInstance !== null) {
          unmountFundamentalComponent(fundamentalInstance);
          current.stateNode = null;
        }
      }
      return;
    }
    case DehydratedFragment: {
      if (enableSuspenseCallback) {
        const hydrationCallbacks = finishedRoot.hydrationCallbacks;
        if (hydrationCallbacks !== null) {
          const onDeleted = hydrationCallbacks.onDeleted;
          if (onDeleted) {
            onDeleted((current.stateNode: SuspenseInstance));
          }
        }
      }
      return;
    }
    case ScopeComponent: {
      if (enableScopeAPI) {
        // 重置ref
        safelyDetachRef(current);
      }
      return;
    }
  }
}

// 递归node及其所有children，执行commitUnmount方法，提交卸载
// FunctionComponent/Block 对需要删除的effect执行destroy方法，destroy也就是useEffect(异步调度)/useLayoutEffect(同步调度)的返回值函数
// ClassComponent 重置ref，调用用户传入的componentWillUnmount方法
// HostComponent 重置ref
// portal组件 重置container
function commitNestedUnmounts(
  finishedRoot: FiberRoot,
  root: Fiber, // nextEffect
  renderPriorityLevel: ReactPriorityLevel,
): void {
  // While we're inside a removed host node we don't want to call
  // removeChild on the inner nodes because they're removed by the top
  // call anyway. We also want to call componentWillUnmount on all
  // composites before this host node is removed from the tree. Therefore
  // we do an inner loop while we're still inside the host node.
  let node: Fiber = root;
  // 递归node及其所有children，执行commitUnmount方法，提交卸载
  // FunctionComponent/Block 对需要删除的effect执行destroy方法，destroy也就是useEffect(异步调度)/useLayoutEffect(同步调度)的返回值函数
  // ClassComponent 重置ref，调用用户传入的componentWillUnmount方法
  // HostComponent 重置ref
  // portal组件 重置container
  while (true) {
    commitUnmount(finishedRoot, node, renderPriorityLevel);
    // Visit children because they may contain more composite or host nodes.
    // Skip portals because commitUnmount() currently visits them recursively.
    // 递归子children
    // 跳过portal组件
    if (
      node.child !== null &&
      // If we use mutation we drill down into portals using commitUnmount above.
      // If we don't use mutation we drill down into portals here instead.
      (!supportsMutation || node.tag !== HostPortal)
    ) {
      node.child.return = node;
      node = node.child;
      continue;
    }
    if (node === root) {
      return;
    }
    // 遍历sibling
    while (node.sibling === null) {
      if (node.return === null || node.return === root) {
        return;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

// fiber  nextEffect/nextEffect对应的currentFiber
// 重置fiber
function detachFiberMutation(fiber: Fiber) {
  // Cut off the return pointers to disconnect it from the tree. Ideally, we
  // should clear the child pointer of the parent alternate to let this
  // get GC:ed but we don't know which for sure which parent is the current
  // one so we'll settle for GC:ing the subtree of this child. This child
  // itself will be GC:ed when the parent updates the next time.
  // Note: we cannot null out sibling here, otherwise it can cause issues
  // with findDOMNode and how it requires the sibling field to carry out
  // traversal in a later effect. See PR #16820. We now clear the sibling
  // field after effects, see: detachFiberAfterEffects.
  //
  // Don't disconnect stateNode now; it will be detached in detachFiberAfterEffects.
  // It may be required if the current component is an error boundary,
  // and one of its descendants throws while unmounting a passive effect.
  fiber.alternate = null;
  fiber.child = null;
  fiber.dependencies = null;
  fiber.firstEffect = null;
  fiber.lastEffect = null;
  fiber.memoizedProps = null;
  fiber.memoizedState = null;
  fiber.pendingProps = null;
  fiber.return = null;
  fiber.updateQueue = null;
  if (__DEV__) {
    fiber._debugOwner = null;
  }
}

// 将portal组件的容器替换为空
function emptyPortalContainer(current: Fiber) {
  if (!supportsPersistence) {
    return;
  }

  const portal: {
    containerInfo: Container,
    pendingChildren: ChildSet,
    ...
  } = current.stateNode;
  const {containerInfo} = portal;
  const emptyChildSet = createContainerChildSet(containerInfo);
  replaceContainerChildren(containerInfo, emptyChildSet);
}

// 提交container
// 除了portal组件外，都使用原container
// portal组件将自己设置的container替换原container
function commitContainer(finishedWork: Fiber) {
  if (!supportsPersistence) {
    return;
  }

  switch (finishedWork.tag) {
    case ClassComponent:
    case HostComponent:
    case HostText:
    case FundamentalComponent: {
      return;
    }
    case HostRoot:
    case HostPortal: {
      // portal组件不是挂载在原来container上的，而是自己设置了一个container
      // 这里做替换container的操作
      const portalOrRoot: {
        containerInfo: Container,
        pendingChildren: ChildSet,
        ...
      } = finishedWork.stateNode;
      const {containerInfo, pendingChildren} = portalOrRoot;
      // 替换portal组件的containerInfo
      replaceContainerChildren(containerInfo, pendingChildren);
      return;
    }
  }
  invariant(
    false,
    'This unit of work tag should not have side-effects. This error is ' +
      'likely caused by a bug in React. Please file an issue.',
  );
}

function getHostParentFiber(fiber: Fiber): Fiber {
  let parent = fiber.return;
  while (parent !== null) {
    // HostComponent HostRoot HostPortal
    if (isHostParent(parent)) {
      return parent;
    }
    parent = parent.return;
  }
  invariant(
    false,
    'Expected to find a host parent. This error is likely caused by a bug ' +
      'in React. Please file an issue.',
  );
}

function isHostParent(fiber: Fiber): boolean {
  return (
    fiber.tag === HostComponent ||
    fiber.tag === HostRoot ||
    fiber.tag === HostPortal
  );
}

// 找到fiber对应的dom进行insertBefore的位置dom
// 这里对组件fiber做了特殊处理，因为组件fiber没有dom，需要转换为其根节点fiber
// 另外，带Placement副作用的组件fiber需要跳过，因为这种fiber也是需要移动的，其dom不能作为位置dom
function getHostSibling(fiber: Fiber): ?Instance {
  // We're going to search forward into the tree until we find a sibling host
  // node. Unfortunately, if multiple insertions are done in a row we have to
  // search past them. This leads to exponential search for the next sibling.
  // TODO: Find a more efficient way to do this.
  let node: Fiber = fiber;
  siblings: while (true) {
    // If we didn't find anything, let's try the next sibling.
    // 没有sibling就找到return.sibling直到return为null
    // 这个while循环是为了给组件fiber的根节点fiber找到其对应dom的insertBefore的位置dom
    // node.sibling为null，说明node是组件fiber的根节点fiber，
    // 这种情况下，node.return.sibling才是这个node实际意义上的sibling
    while (node.sibling === null) {
      if (node.return === null || isHostParent(node.return)) {
        // If we pop out of the root or hit the parent the fiber we are the
        // last sibling.
        return null;
      }
      node = node.return;
    }
    // 走到这里，表明找到了node.sibling
    // 给sibling加上return指引
    node.sibling.return = node.return;
    // node指向其sibling兄弟fiber
    node = node.sibling;
    // node不是host node(也就是不是原生dom fiber，一般为组件fiber)
    // 找到组件fiber的child，也就是根节点fiber，如果还是组件fiber，继续找根节点fiber，直到是原生dom fiber
    // 寻找原生dom根fiber的流程中，如果组件fiber带Placement副作用，说明该fiber也需要移动位置，那insertBefore的位置dom和该fiber就无关，
    // 所以直接跳出当前循环，继续从该fiber的sibling开始
    while (
      node.tag !== HostComponent &&
      node.tag !== HostText &&
      node.tag !== DehydratedFragment
    ) {
      // If it is not host node and, we might have a host node inside it.
      // Try to search down until we find one.
      // node不是host node

      // node有Placement副作用，直接跳到下一个循环，也就是继续找兄弟fiber
      if (node.flags & Placement) {
        // If we don't have a child, try the siblings instead.
        continue siblings;
      }
      // If we don't have a child, try the siblings instead.
      // We also skip portals because they are not part of this host tree.
      // portals不在host tree内，这里不考虑
      if (node.child === null || node.tag === HostPortal) {
        continue siblings;
      } else {
        // 找到兄弟fiber node上的第一个子fiber node.child(也就是组件fiber的根fiber)
        node.child.return = node;
        node = node.child;
      }
    }
    // Check if this host node is stable or about to be placed.
    // 这里已经找到了host node
    // node不需要Placement副作用，就返回node.stateNode
    // 只有没有Placement副作用的fiber对应的dom，才能作为insertBefore的位置dom
    if (!(node.flags & Placement)) {
      // Found it!
      return node.stateNode;
    }
  }
}

// finishedWork  nextEffect
// 将finishedWork对应的dom插入到dom结构中的对应位置
function commitPlacement(finishedWork: Fiber): void {
  if (!supportsMutation) {
    return;
  }

  // Recursively insert all host nodes into the parent.
  // 找到最近的一个 HostComponent HostRoot HostPortal 父workInProgress
  const parentFiber = getHostParentFiber(finishedWork);

  // Note: these two variables *must* always be updated together.
  let parent;
  let isContainer;
  // parentFiber对应的stateNode
  const parentStateNode = parentFiber.stateNode;
  // parent指向dom或者container
  switch (parentFiber.tag) {
    case HostComponent:
      parent = parentStateNode;
      isContainer = false;
      break;
    case HostRoot:
      parent = parentStateNode.containerInfo;
      isContainer = true;
      break;
    case HostPortal:
      parent = parentStateNode.containerInfo;
      isContainer = true;
      break;
    case FundamentalComponent:
      if (enableFundamentalAPI) {
        parent = parentStateNode.instance;
        isContainer = false;
      }
    // eslint-disable-next-line-no-fallthrough
    default:
      invariant(
        false,
        'Invalid host parent fiber. This error is likely caused by a bug ' +
          'in React. Please file an issue.',
      );
  }
  // 处理parent的ContentReset副作用
  // 在这之前只处理了finishedWork的ContentReset副作用
  if (parentFiber.flags & ContentReset) {
    // Reset the text content of the parent before doing any insertions
    // 重置parent对应的dom的文本为''
    resetTextContent(parent);
    // Clear ContentReset from the effect tag
    parentFiber.flags &= ~ContentReset;
  }

  // 找到fiber对应的dom进行insertBefore的位置dom
  // 这里对组件fiber做了特殊处理，因为组件fiber没有dom，需要转换为其根节点fiber
  // 另外，带Placement副作用的组件fiber需要跳过，因为这种fiber也是需要移动的，其dom不能作为位置dom
  const before = getHostSibling(finishedWork);
  // We only have the top Fiber that was inserted but we need to recurse down its
  // children to find all the terminal nodes.

  // 将node(fragment就是node的所有child)插入到parent中
  if (isContainer) {
    // 将node(fragment就是node的所有child)插入到parent中
    insertOrAppendPlacementNodeIntoContainer(finishedWork, before, parent);
  } else {
    // 将node(fragment就是node的所有child)插入到parent中
    insertOrAppendPlacementNode(finishedWork, before, parent);
  }
}

// 将node(fragment就是node的所有child)插入到parent中
function insertOrAppendPlacementNodeIntoContainer(
  node: Fiber, // finishedWork
  before: ?Instance,
  parent: Container,
): void {
  const {tag} = node;
  const isHost = tag === HostComponent || tag === HostText;
  if (isHost || (enableFundamentalAPI && tag === FundamentalComponent)) {
    // 获取dom
    const stateNode = isHost ? node.stateNode : node.stateNode.instance;
    if (before) {
      // 将stateNode插入到parent中before之前
      insertInContainerBefore(parent, stateNode, before);
    } else {
      // 将child插入到container中
      appendChildToContainer(parent, stateNode);
    }
  } else if (tag === HostPortal) {
    // If the insertion itself is a portal, then we don't want to traverse
    // down its children. Instead, we'll get insertions from each child in
    // the portal directly.
    // portal组件不需要在这里插入，直接插入到对应位置
  } else {
    // fragment
    // 将node的所有child插入到parent中
    const child = node.child;
    if (child !== null) {
      insertOrAppendPlacementNodeIntoContainer(child, before, parent);
      let sibling = child.sibling;
      while (sibling !== null) {
        insertOrAppendPlacementNodeIntoContainer(sibling, before, parent);
        sibling = sibling.sibling;
      }
    }
  }
}

// 将node(fragment就是node的所有child)插入到parent中
// 逻辑同insertOrAppendPlacementNodeIntoContainer，只是这里的parent一定为dom
function insertOrAppendPlacementNode(
  node: Fiber,
  before: ?Instance,
  parent: Instance,
): void {
  const {tag} = node;
  const isHost = tag === HostComponent || tag === HostText;
  if (isHost || (enableFundamentalAPI && tag === FundamentalComponent)) {
    const stateNode = isHost ? node.stateNode : node.stateNode.instance;
    if (before) {
      insertBefore(parent, stateNode, before);
    } else {
      appendChild(parent, stateNode);
    }
  } else if (tag === HostPortal) {
    // If the insertion itself is a portal, then we don't want to traverse
    // down its children. Instead, we'll get insertions from each child in
    // the portal directly.
  } else {
    const child = node.child;
    if (child !== null) {
      insertOrAppendPlacementNode(child, before, parent);
      let sibling = child.sibling;
      while (sibling !== null) {
        insertOrAppendPlacementNode(sibling, before, parent);
        sibling = sibling.sibling;
      }
    }
  }
}

// 遍历current及其所有sibling进行卸载，对有必要的child也进行卸载，这里会对根fiber对应的dom结构进行移除
function unmountHostComponents(
  finishedRoot: FiberRoot,
  current: Fiber, // nextEffect
  renderPriorityLevel: ReactPriorityLevel,
): void {
  // We only have the top Fiber that was deleted but we need to recurse down its
  // children to find all the terminal nodes.
  let node: Fiber = current;

  // Each iteration, currentParent is populated with node's host parent if not
  // currentParentIsValid.
  let currentParentIsValid = false;

  // Note: these two variables *must* always be updated together.
  let currentParent;
  let currentParentIsContainer;
  
  // 遍历node及其所有sibling进行卸载，对有必要的child也进行卸载
  while (true) {
    // 通过return向上查找最近的host node，将其dom或container设置为currentParent
    // 完毕后将currentParentIsValid置为true
    if (!currentParentIsValid) {
      let parent = node.return;
      findParent: while (true) {
        invariant(
          parent !== null,
          'Expected to find a host parent. This error is likely caused by ' +
            'a bug in React. Please file an issue.',
        );
        const parentStateNode = parent.stateNode;
        switch (parent.tag) {
          case HostComponent:
            currentParent = parentStateNode;
            currentParentIsContainer = false;
            break findParent;
          case HostRoot:
            currentParent = parentStateNode.containerInfo;
            currentParentIsContainer = true;
            break findParent;
          case HostPortal:
            currentParent = parentStateNode.containerInfo;
            currentParentIsContainer = true;
            break findParent;
          case FundamentalComponent:
            if (enableFundamentalAPI) {
              currentParent = parentStateNode.instance;
              currentParentIsContainer = false;
            }
        }
        parent = parent.return;
      }
      currentParentIsValid = true;
    }

    if (node.tag === HostComponent || node.tag === HostText) {
      // 原生dom或原生text
      // 递归node及其所有children，进行卸载，然后在currentParent中移除node对应的dom

      // 递归node及其所有children，执行commitUnmount方法，提交卸载
      commitNestedUnmounts(finishedRoot, node, renderPriorityLevel);
      // After all the children have unmounted, it is now safe to remove the
      // node from the tree.
      // 这里已经完成对node及其所有children的递归卸载
      // 接一下将node对应的dom从currentParent dom结构上移除
      if (currentParentIsContainer) {
        removeChildFromContainer(
          ((currentParent: any): Container),
          (node.stateNode: Instance | TextInstance),
        );
      } else {
        removeChild(
          ((currentParent: any): Instance),
          (node.stateNode: Instance | TextInstance),
        );
      }
      // Don't visit children because we already visited them.
    } else if (enableFundamentalAPI && node.tag === FundamentalComponent) {
      const fundamentalNode = node.stateNode.instance;
      // 递归node及其所有children，执行commitUnmount方法，提交卸载
      commitNestedUnmounts(finishedRoot, node, renderPriorityLevel);
      // After all the children have unmounted, it is now safe to remove the
      // node from the tree.
      // 将node对应的dom从currentParent dom结构上移除
      if (currentParentIsContainer) {
        removeChildFromContainer(
          ((currentParent: any): Container),
          (fundamentalNode: Instance),
        );
      } else {
        removeChild(
          ((currentParent: any): Instance),
          (fundamentalNode: Instance),
        );
      }
    } else if (
      enableSuspenseServerRenderer &&
      node.tag === DehydratedFragment
    ) {
      // SSR 暂时不看???
      if (enableSuspenseCallback) {
        const hydrationCallbacks = finishedRoot.hydrationCallbacks;
        if (hydrationCallbacks !== null) {
          const onDeleted = hydrationCallbacks.onDeleted;
          if (onDeleted) {
            onDeleted((node.stateNode: SuspenseInstance));
          }
        }
      }

      // Delete the dehydrated suspense boundary and all of its content.
      if (currentParentIsContainer) {
        clearSuspenseBoundaryFromContainer(
          ((currentParent: any): Container),
          (node.stateNode: SuspenseInstance),
        );
      } else {
        clearSuspenseBoundary(
          ((currentParent: any): Instance),
          (node.stateNode: SuspenseInstance),
        );
      }
    } else if (node.tag === HostPortal) {
      // portal组件
      // 设置好currentParent，然后卸载其所有children
      if (node.child !== null) {
        // When we go into a portal, it becomes the parent to remove from.
        // We will reassign it back when we pop the portal on the way up.
        currentParent = node.stateNode.containerInfo;
        currentParentIsContainer = true;
        // Visit children because portals might contain host components.
        node.child.return = node;
        node = node.child;
        continue;
      }
    } else {
      // 递归nextEffect及其所有children执行这个方法，提交卸载
      // FunctionComponent 对需要删除的effect执行destroy方法，destroy也就是useEffect(异步调度)/useLayoutEffect(同步调度)的返回值函数
      // ClassComponent 重置ref，调用用户传入的componentWillUnmount方法
      // HostComponent 重置ref
      // portal组件 重置container
      // 卸载node，然后对其child进行判断
      // 这里的node应该是没有对应dom结构，所以不用做移除???
      commitUnmount(finishedRoot, node, renderPriorityLevel);
      // Visit children because we may find more host components below.
      if (node.child !== null) {
        node.child.return = node;
        node = node.child;
        continue;
      }
    }
    if (node === current) {
      return;
    }
    while (node.sibling === null) {
      if (node.return === null || node.return === current) {
        return;
      }
      node = node.return;
      // portal组件需要重新找currentParent
      if (node.tag === HostPortal) {
        // When we go out of the portal, we need to restore the parent.
        // Since we don't keep a stack of them, we will search for it.
        currentParentIsValid = false;
      }
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

// 提交删除，对current及其children(这也可能还有sibling)做卸载，移除dom结构
// FunctionComponent/Block 对需要删除的effect执行destroy方法，destroy也就是useEffect(异步调度)/useLayoutEffect(同步调度)的返回值函数
// ClassComponent 重置ref，调用用户传入的componentWillUnmount方法
// HostComponent 重置ref
// portal组件 重置container
// 最后重置current及其对应的currentFiber
// 只对根fiber对应的dom结构进行移除，子fiber对应的dom自然就移除了，不需要对子fiber对应的dom进行额外的移除操作
function commitDeletion(
  finishedRoot: FiberRoot,
  current: Fiber, // nextEffect
  renderPriorityLevel: ReactPriorityLevel,
): void {
  // 只对根fiber对应的dom结构进行移除，子fiber对应的dom自然就移除了，不需要对子fiber对应的dom进行额外的移除操作
  if (supportsMutation) {
    // Recursively delete all host nodes from the parent.
    // Detach refs and call componentWillUnmount() on the whole subtree.
    // 遍历current及其所有sibling进行卸载，对有必要的child也进行卸载，并移除dom结构
    // 内部执行commitNestedUnmounts，调用componentWillUnmount
    unmountHostComponents(finishedRoot, current, renderPriorityLevel);
  } else {
    // Detach refs and call componentWillUnmount() on the whole subtree.
    // 递归current及其所有children(不处理current的sibling)，执行commitUnmount方法，提交卸载，不会移除dom结构(因为父fiber对应的dom已经被移除了，子fiber对应的dom自然也就被移除了，不需要额外操作)
    // FunctionComponent/Block 对需要删除的effect执行destroy方法，destroy也就是useEffect(异步调度)/useLayoutEffect(同步调度)的返回值函数
    // ClassComponent 重置ref，调用用户传入的componentWillUnmount方法
    // HostComponent 重置ref
    // portal组件 重置container
    commitNestedUnmounts(finishedRoot, current, renderPriorityLevel);
  }
  const alternate = current.alternate; // nextEffect对应的currentFiber
  // 重置current(nextEffect)
  detachFiberMutation(current);
  if (alternate !== null) {
    // 重置alternate(nextEffect对应的currentFiber)
    detachFiberMutation(alternate);
  }
}

// 做 销毁 显示/隐藏 更新container 更新dom(根据diff的结构updatePayload) 更新dom文本 执行useLayoutEffect的destroy 的操作
function commitWork(current: Fiber | null, finishedWork: Fiber): void {
  if (!supportsMutation) {
    switch (finishedWork.tag) {
      case FunctionComponent:
      case ForwardRef:
      case MemoComponent:
      case SimpleMemoComponent:
      case Block: {
        // Layout effects are destroyed during the mutation phase so that all
        // destroy functions for all fibers are called before any create functions.
        // This prevents sibling component effects from interfering with each other,
        // e.g. a destroy function in one component should never override a ref set
        // by a create function in another component during the same commit.
        // 先销毁后创建，这样就不会形成交集

        // 这里做销毁操作
        if (
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          finishedWork.mode & ProfileMode
        ) {
          try {
            // 记录layout effect开始时间
            startLayoutEffectTimer();
            // tag  HookLayout | HookHasEffect，表示useLayoutEffect
            // 将finishedWork.updateQueue.lastEffect之后的effect都执行destroy
            // 这里处理的是useLayoutEffect
            commitHookEffectListUnmount(
              HookLayout | HookHasEffect,
              finishedWork,
            );
          } finally {
            // 记录layout effect持续时间并添加到父fiber和祖先fiber的stateNode.effectDuration上
            recordLayoutEffectDuration(finishedWork);
          }
        } else {
          // 将finishedWork.updateQueue.lastEffect之后的effect都执行destroy
          commitHookEffectListUnmount(HookLayout | HookHasEffect, finishedWork);
        }
        return;
      }
      case Profiler: {
        return;
      }
      case SuspenseComponent: {
        // 处理suspense组件
        // 递归finishedWork.child及其所有children，进行隐藏操作(修改display)
        commitSuspenseComponent(finishedWork);
        // 处理超时的情况，便于在primary state重新render
        attachSuspenseRetryListeners(finishedWork);
        return;
      }
      case SuspenseListComponent: {
        // 处理超时的情况，便于在primary state重新render
        attachSuspenseRetryListeners(finishedWork);
        return;
      }
      case HostRoot: {
        if (supportsHydration) {
          const root: FiberRoot = finishedWork.stateNode;
          if (root.hydrate) {
            // We've just hydrated. No need to hydrate again.
            // 处理SSR hydrate
            // 将root.hydrate置为false，表明只进行一次这个逻辑
            root.hydrate = false;
            // SSR暂时不看???
            commitHydratedContainer(root.containerInfo);
          }
        }
        break;
      }
      case OffscreenComponent:
      case LegacyHiddenComponent: {
        return;
      }
    }

    // 非以上switch情况
    // 提交container，主要是对portal组件对应的container进行替换
    commitContainer(finishedWork);
    return;
  }

  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case MemoComponent:
    case SimpleMemoComponent:
    case Block: {
      // Layout effects are destroyed during the mutation phase so that all
      // destroy functions for all fibers are called before any create functions.
      // This prevents sibling component effects from interfering with each other,
      // e.g. a destroy function in one component should never override a ref set
      // by a create function in another component during the same commit.
      // 逻辑同上一个switch，做销毁操作
      if (
        enableProfilerTimer &&
        enableProfilerCommitHooks &&
        finishedWork.mode & ProfileMode
      ) {
        try {
          startLayoutEffectTimer();
          // tag  HookLayout | HookHasEffect，表示useLayoutEffect
          // 将finishedWork.updateQueue.lastEffect之后的effect都执行destroy
          // 这里处理的是useLayoutEffect
          commitHookEffectListUnmount(HookLayout | HookHasEffect, finishedWork);
        } finally {
          recordLayoutEffectDuration(finishedWork);
        }
      } else {
        // tag  HookLayout | HookHasEffect，表示useLayoutEffect
        // 将finishedWork.updateQueue.lastEffect之后的effect都执行destroy
        // 这里处理的是useLayoutEffect
        commitHookEffectListUnmount(HookLayout | HookHasEffect, finishedWork);
      }
      return;
    }
    case ClassComponent: {
      return;
    }
    case HostComponent: {
      const instance: Instance = finishedWork.stateNode;
      if (instance != null) {
        // Commit the work prepared earlier.
        const newProps = finishedWork.memoizedProps;
        // For hydration we reuse the update path but we treat the oldProps
        // as the newProps. The updatePayload will contain the real change in
        // this case.
        // SSR 会在hydrate中将oldProps同步为newProps，而在updatePayload存储change

        const oldProps = current !== null ? current.memoizedProps : newProps;
        const type = finishedWork.type;
        // TODO: Type the updateQueue to be specific to host components.
        const updatePayload: null | UpdatePayload = (finishedWork.updateQueue: any);
        finishedWork.updateQueue = null;
        if (updatePayload !== null) {
          // 提交更新，将diff的结果(也就是updatePayload)更新到domElement中
          commitUpdate(
            instance,
            updatePayload,
            type,
            oldProps,
            newProps,
            finishedWork,
          );
        }
      }
      return;
    }
    case HostText: {
      invariant(
        finishedWork.stateNode !== null,
        'This should have a text node initialized. This error is likely ' +
          'caused by a bug in React. Please file an issue.',
      );
      const textInstance: TextInstance = finishedWork.stateNode;
      const newText: string = finishedWork.memoizedProps;
      // For hydration we reuse the update path but we treat the oldProps
      // as the newProps. The updatePayload will contain the real change in
      // this case.
      const oldText: string =
        current !== null ? current.memoizedProps : newText;
      // 更新textInstance的文本
      commitTextUpdate(textInstance, oldText, newText);
      return;
    }
    case HostRoot: {
      // 同上一个switch
      if (supportsHydration) {
        const root: FiberRoot = finishedWork.stateNode;
        if (root.hydrate) {
          // We've just hydrated. No need to hydrate again.
          root.hydrate = false;
          commitHydratedContainer(root.containerInfo);
        }
      }
      return;
    }
    case Profiler: {
      return;
    }
    case SuspenseComponent: {
      // 处理suspense组件，同上一个switch
      // 递归finishedWork.child及其所有children，进行隐藏操作(修改display)
      commitSuspenseComponent(finishedWork);
      // 处理超时的情况，便于在primary state重新render
      attachSuspenseRetryListeners(finishedWork);
      return;
    }
    case SuspenseListComponent: {
      // 同上一个switch
      // 处理超时的情况，便于在primary state重新render
      attachSuspenseRetryListeners(finishedWork);
      return;
    }
    case IncompleteClassComponent: {
      return;
    }
    case FundamentalComponent: {
      // ???
      if (enableFundamentalAPI) {
        const fundamentalInstance = finishedWork.stateNode;
        updateFundamentalComponent(fundamentalInstance);
        return;
      }
      break;
    }
    case ScopeComponent: {
      if (enableScopeAPI) {
        const scopeInstance = finishedWork.stateNode;
        // scopeInstance.internalInstanceKey = finishedWork
        prepareScopeUpdate(scopeInstance, finishedWork);
        return;
      }
      break;
    }
    case OffscreenComponent:
    case LegacyHiddenComponent: {
      const newState: OffscreenState | null = finishedWork.memoizedState;
      // 有newState 显示
      // 无newState 隐藏
      const isHidden = newState !== null;
      // // 递归finishedWork及其所有children，进行显示隐藏操作(修改display)
      hideOrUnhideAllChildren(finishedWork, isHidden);
      return;
    }
  }
  invariant(
    false,
    'This unit of work tag should not have side-effects. This error is ' +
      'likely caused by a bug in React. Please file an issue.',
  );
}

// 处理suspense组件
// 递归finishedWork.child及其所有children，进行隐藏操作(修改display)
function commitSuspenseComponent(finishedWork: Fiber) {
  const newState: SuspenseState | null = finishedWork.memoizedState;

  // newState不为null，表明suspense组件需要显示
  if (newState !== null) {
    markCommitTimeOfFallback();

    if (supportsMutation) {
      // Hide the Offscreen component that contains the primary children. TODO:
      // Ideally, this effect would have been scheduled on the Offscreen fiber
      // itself. That's how unhiding works: the Offscreen component schedules an
      // effect on itself. However, in this case, the component didn't complete,
      // so the fiber was never added to the effect list in the normal path. We
      // could have appended it to the effect list in the Suspense component's
      // second pass, but doing it this way is less complicated. This would be
      // simpler if we got rid of the effect list and traversed the tree, like
      // we're planning to do.
      // suspense组件只有第一个child
      const primaryChildParent: Fiber = (finishedWork.child: any);
      // 递归primaryChildParent及其所有children，进行隐藏操作(修改display)
      // 传入isHidden为true
      hideOrUnhideAllChildren(primaryChildParent, true);
    }
  }

  // 执行suspense组件的回调，传入new Set(finishedWork.updateQueue)
  if (enableSuspenseCallback && newState !== null) {
    const suspenseCallback = finishedWork.memoizedProps.suspenseCallback;
    if (typeof suspenseCallback === 'function') {
      const wakeables: Set<Wakeable> | null = (finishedWork.updateQueue: any);
      if (wakeables !== null) {
        suspenseCallback(new Set(wakeables));
      }
    } else if (__DEV__) {
      if (suspenseCallback !== undefined) {
        console.error('Unexpected type for suspenseCallback.');
      }
    }
  }
}

function commitSuspenseHydrationCallbacks(
  finishedRoot: FiberRoot,
  finishedWork: Fiber,
) {
  if (!supportsHydration) {
    return;
  }
  const newState: SuspenseState | null = finishedWork.memoizedState;
  if (newState === null) {
    const current = finishedWork.alternate;
    if (current !== null) {
      const prevState: SuspenseState | null = current.memoizedState;
      if (prevState !== null) {
        const suspenseInstance = prevState.dehydrated;
        if (suspenseInstance !== null) {
          commitHydratedSuspenseInstance(suspenseInstance);
          if (enableSuspenseCallback) {
            const hydrationCallbacks = finishedRoot.hydrationCallbacks;
            if (hydrationCallbacks !== null) {
              const onHydrated = hydrationCallbacks.onHydrated;
              if (onHydrated) {
                onHydrated(suspenseInstance);
              }
            }
          }
        }
      }
    }
  }
}

// 处理超时的情况，便于在primary state重新render
function attachSuspenseRetryListeners(finishedWork: Fiber) {
  // If this boundary just timed out, then it will have a set of wakeables.
  // For each wakeable, attach a listener so that when it resolves, React
  // attempts to re-render the boundary in the primary (pre-timeout) state.
  // 一旦超时，就会有wakeables，用于react在primary state重新render这种情况

  const wakeables: Set<Wakeable> | null = (finishedWork.updateQueue: any);
  if (wakeables !== null) {
    finishedWork.updateQueue = null;
    let retryCache = finishedWork.stateNode;
    if (retryCache === null) {
      retryCache = finishedWork.stateNode = new PossiblyWeakSet();
    }
    wakeables.forEach((wakeable) => {
      // Memoize using the boundary fiber to prevent redundant listeners.
      let retry = resolveRetryWakeable.bind(null, finishedWork, wakeable);
      if (!retryCache.has(wakeable)) {
        if (enableSchedulerTracing) {
          if (wakeable.__reactDoNotTraceInteractions !== true) {
            retry = Schedule_tracing_wrap(retry);
          }
        }
        retryCache.add(wakeable);
        wakeable.then(retry, retry);
      }
    });
  }
}

// This function detects when a Suspense boundary goes from visible to hidden.
// It returns false if the boundary is already hidden.
// TODO: Use an effect tag.
// suspense组件是否显示
// true为显示 false为隐藏
export function isSuspenseBoundaryBeingHidden(
  current: Fiber | null,
  finishedWork: Fiber, // nextEffect
): boolean {
  if (current !== null) {
    const oldState: SuspenseState | null = current.memoizedState;
    if (oldState === null || oldState.dehydrated !== null) {
      const newState: SuspenseState | null = finishedWork.memoizedState;
      return newState !== null && newState.dehydrated === null;
    }
  }
  return false;
}

// current  nextEffect
// 重置current.stateNode的文本为''
function commitResetTextContent(current: Fiber) {
  if (!supportsMutation) {
    return;
  }
  // 重置current.stateNode的文本为''
  resetTextContent(current.stateNode);
}

export {
  commitBeforeMutationLifeCycles,
  commitResetTextContent,
  commitPlacement,
  commitDeletion,
  commitWork,
  commitLifeCycles,
  commitAttachRef,
  commitDetachRef,
};
