/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  MutableSource,
  MutableSourceGetSnapshotFn,
  MutableSourceSubscribeFn,
  ReactContext,
} from 'shared/ReactTypes';
import type {Fiber, Dispatcher} from './ReactInternalTypes';
import type {Lanes, Lane} from './ReactFiberLane';
import type {HookFlags} from './ReactHookEffectTags';
import type {ReactPriorityLevel} from './ReactInternalTypes';
import type {FiberRoot} from './ReactInternalTypes';
import type {OpaqueIDType} from './ReactFiberHostConfig';

import ReactSharedInternals from 'shared/ReactSharedInternals';
import {
  enableDebugTracing,
  enableSchedulingProfiler,
  enableNewReconciler,
  decoupleUpdatePriorityFromScheduler,
  enableUseRefAccessWarning,
} from 'shared/ReactFeatureFlags';

import {NoMode, BlockingMode, DebugTracingMode} from './ReactTypeOfMode';
import {
  NoLane,
  NoLanes,
  InputContinuousLanePriority,
  isSubsetOfLanes,
  mergeLanes,
  removeLanes,
  markRootEntangled,
  markRootMutableRead,
  getCurrentUpdateLanePriority,
  setCurrentUpdateLanePriority,
  higherLanePriority,
  DefaultLanePriority,
} from './ReactFiberLane';
import {readContext} from './ReactFiberNewContext.old';
import {
  Update as UpdateEffect,
  Passive as PassiveEffect,
} from './ReactFiberFlags';
import {
  HasEffect as HookHasEffect,
  Layout as HookLayout,
  Passive as HookPassive,
} from './ReactHookEffectTags';
import {
  getWorkInProgressRoot,
  scheduleUpdateOnFiber,
  requestUpdateLane,
  requestEventTime,
  warnIfNotCurrentlyActingEffectsInDEV,
  warnIfNotCurrentlyActingUpdatesInDev,
  warnIfNotScopedWithMatchingAct,
  markSkippedUpdateLanes,
} from './ReactFiberWorkLoop.old';

import invariant from 'shared/invariant';
import getComponentName from 'shared/getComponentName';
import is from 'shared/objectIs';
import {markWorkInProgressReceivedUpdate} from './ReactFiberBeginWork.old';
import {
  UserBlockingPriority,
  NormalPriority,
  runWithPriority,
  getCurrentPriorityLevel,
} from './SchedulerWithReactIntegration.old';
import {getIsHydrating} from './ReactFiberHydrationContext.old';
import {
  makeClientId,
  makeClientIdInDEV,
  makeOpaqueHydratingObject,
} from './ReactFiberHostConfig';
import {
  getWorkInProgressVersion,
  markSourceAsDirty,
  setWorkInProgressVersion,
  warnAboutMultipleRenderersDEV,
} from './ReactMutableSource.old';
import {getIsRendering} from './ReactCurrentFiber';
import {logStateUpdateScheduled} from './DebugTracing';
import {markStateUpdateScheduled} from './SchedulingProfiler';

const {ReactCurrentDispatcher, ReactCurrentBatchConfig} = ReactSharedInternals;

type Update<S, A> = {|
  lane: Lane,
  action: A,
  eagerReducer: ((S, A) => S) | null,
  eagerState: S | null,
  next: Update<S, A>,
  priority?: ReactPriorityLevel,
|};

type UpdateQueue<S, A> = {|
  pending: Update<S, A> | null,
  dispatch: (A => mixed) | null,
  lastRenderedReducer: ((S, A) => S) | null,
  lastRenderedState: S | null,
|};

export type HookType =
  | 'useState'
  | 'useReducer'
  | 'useContext'
  | 'useRef'
  | 'useEffect'
  | 'useLayoutEffect'
  | 'useCallback'
  | 'useMemo'
  | 'useImperativeHandle'
  | 'useDebugValue'
  | 'useDeferredValue'
  | 'useTransition'
  | 'useMutableSource'
  | 'useOpaqueIdentifier';

let didWarnAboutMismatchedHooksForComponent;
let didWarnAboutUseOpaqueIdentifier;
if (__DEV__) {
  didWarnAboutUseOpaqueIdentifier = {};
  didWarnAboutMismatchedHooksForComponent = new Set();
}

export type Hook = {|
  memoizedState: any,
  baseState: any,
  baseQueue: Update<any, any> | null,
  queue: UpdateQueue<any, any> | null,
  next: Hook | null,
|};

export type Effect = {|
  tag: HookFlags,
  create: () => (() => void) | void,
  destroy: (() => void) | void,
  deps: Array<mixed> | null,
  next: Effect,
|};

export type FunctionComponentUpdateQueue = {|lastEffect: Effect | null|};

type BasicStateAction<S> = (S => S) | S;

type Dispatch<A> = A => void;

// These are set right before calling the component.
let renderLanes: Lanes = NoLanes;
// The work-in-progress fiber. I've named it differently to distinguish it from
// the work-in-progress hook.
let currentlyRenderingFiber: Fiber = (null: any);

// Hooks are stored as a linked list on the fiber's memoizedState field. The
// current hook list is the list that belongs to the current fiber. The
// work-in-progress hook list is a new list that will be added to the
// work-in-progress fiber.
// hooks是一个list，存储在memoizedState
// currentlyRenderingFiber.memoizedState指向workInProgressHook链表
// currentHook list属于currentFiber
// workInProgressHook list是新的list
let currentHook: Hook | null = null;
let workInProgressHook: Hook | null = null;

// Whether an update was scheduled at any point during the render phase. This
// does not get reset if we do another render pass; only when we're completely
// finished evaluating this component. This is an optimization so we know
// whether we need to clear render phase updates after a throw.
let didScheduleRenderPhaseUpdate: boolean = false;
// Where an update was scheduled only during the current render pass. This
// gets reset after each attempt.
// TODO: Maybe there's some way to consolidate this with
// `didScheduleRenderPhaseUpdate`. Or with `numberOfReRenders`.
let didScheduleRenderPhaseUpdateDuringThisPass: boolean = false;

const RE_RENDER_LIMIT = 25;

// In DEV, this is the name of the currently executing primitive hook
let currentHookNameInDev: ?HookType = null;

// In DEV, this list ensures that hooks are called in the same order between renders.
// The list stores the order of hooks used during the initial render (mount).
// Subsequent renders (updates) reference this list.
let hookTypesDev: Array<HookType> | null = null;
let hookTypesUpdateIndexDev: number = -1;

// In DEV, this tracks whether currently rendering component needs to ignore
// the dependencies for Hooks that need them (e.g. useEffect or useMemo).
// When true, such Hooks will always be "remounted". Only used during hot reload.
let ignorePreviousDependencies: boolean = false;

function mountHookTypesDev() {
  if (__DEV__) {
    const hookName = ((currentHookNameInDev: any): HookType);

    if (hookTypesDev === null) {
      hookTypesDev = [hookName];
    } else {
      hookTypesDev.push(hookName);
    }
  }
}

function updateHookTypesDev() {
  if (__DEV__) {
    const hookName = ((currentHookNameInDev: any): HookType);

    if (hookTypesDev !== null) {
      hookTypesUpdateIndexDev++;
      if (hookTypesDev[hookTypesUpdateIndexDev] !== hookName) {
        warnOnHookMismatchInDev(hookName);
      }
    }
  }
}

function checkDepsAreArrayDev(deps: mixed) {
  if (__DEV__) {
    if (deps !== undefined && deps !== null && !Array.isArray(deps)) {
      // Verify deps, but only on mount to avoid extra checks.
      // It's unlikely their type would change as usually you define them inline.
      console.error(
        '%s received a final argument that is not an array (instead, received `%s`). When ' +
          'specified, the final argument must be an array.',
        currentHookNameInDev,
        typeof deps,
      );
    }
  }
}

function warnOnHookMismatchInDev(currentHookName: HookType) {
  if (__DEV__) {
    const componentName = getComponentName(currentlyRenderingFiber.type);
    if (!didWarnAboutMismatchedHooksForComponent.has(componentName)) {
      didWarnAboutMismatchedHooksForComponent.add(componentName);

      if (hookTypesDev !== null) {
        let table = '';

        const secondColumnStart = 30;

        for (let i = 0; i <= ((hookTypesUpdateIndexDev: any): number); i++) {
          const oldHookName = hookTypesDev[i];
          const newHookName =
            i === ((hookTypesUpdateIndexDev: any): number)
              ? currentHookName
              : oldHookName;

          let row = `${i + 1}. ${oldHookName}`;

          // Extra space so second column lines up
          // lol @ IE not supporting String#repeat
          while (row.length < secondColumnStart) {
            row += ' ';
          }

          row += newHookName + '\n';

          table += row;
        }

        console.error(
          'React has detected a change in the order of Hooks called by %s. ' +
            'This will lead to bugs and errors if not fixed. ' +
            'For more information, read the Rules of Hooks: https://reactjs.org/link/rules-of-hooks\n\n' +
            '   Previous render            Next render\n' +
            '   ------------------------------------------------------\n' +
            '%s' +
            '   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n',
          componentName,
          table,
        );
      }
    }
  }
}

function throwInvalidHookError() {
  invariant(
    false,
    'Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for' +
      ' one of the following reasons:\n' +
      '1. You might have mismatching versions of React and the renderer (such as React DOM)\n' +
      '2. You might be breaking the Rules of Hooks\n' +
      '3. You might have more than one copy of React in the same app\n' +
      'See https://reactjs.org/link/invalid-hook-call for tips about how to debug and fix this problem.',
  );
}

// 新老依赖项数组是否相同
function areHookInputsEqual(
  nextDeps: Array<mixed>,
  prevDeps: Array<mixed> | null,
) {
  if (__DEV__) {
    if (ignorePreviousDependencies) {
      // Only true when this component is being hot reloaded.
      return false;
    }
  }

  if (prevDeps === null) {
    if (__DEV__) {
      console.error(
        '%s received a final argument during this render, but not during ' +
          'the previous render. Even though the final argument is optional, ' +
          'its type cannot change between renders.',
        currentHookNameInDev,
      );
    }
    return false;
  }

  if (__DEV__) {
    // Don't bother comparing lengths in prod because these arrays should be
    // passed inline.
    if (nextDeps.length !== prevDeps.length) {
      console.error(
        'The final argument passed to %s changed size between renders. The ' +
          'order and size of this array must remain constant.\n\n' +
          'Previous: %s\n' +
          'Incoming: %s',
        currentHookNameInDev,
        `[${prevDeps.join(', ')}]`,
        `[${nextDeps.join(', ')}]`,
      );
    }
  }
  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    if (is(nextDeps[i], prevDeps[i])) {
      continue;
    }
    return false;
  }
  return true;
}

// 在Component(props, secondArg)生成children的过程中，会执行构造函数中的hooks相关方法
export function renderWithHooks<Props, SecondArg>(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: (p: Props, arg: SecondArg) => any, // 函数组件的构造函数
  props: Props, // 处理过的新props
  secondArg: SecondArg, // context
  nextRenderLanes: Lanes,
): any {
  renderLanes = nextRenderLanes;
  // 全局标记当前正在render的workInProgress
  currentlyRenderingFiber = workInProgress;

  if (__DEV__) {
    hookTypesDev =
      current !== null
        ? ((current._debugHookTypes: any): Array<HookType>)
        : null;
    hookTypesUpdateIndexDev = -1;
    // Used for hot reloading:
    ignorePreviousDependencies =
      current !== null && current.type !== workInProgress.type;
  }

  // 下面三个属性 memoizedState updateQueue lanes 用于类组件，这里是hooks函数组件，重置为空
  workInProgress.memoizedState = null;
  // hooks函数组件的updateQueue用于存放useEffect对应的effect对象循环单链表
  workInProgress.updateQueue = null;
  workInProgress.lanes = NoLanes;

  // The following should have already been reset
  // currentHook = null;
  // workInProgressHook = null;

  // didScheduleRenderPhaseUpdate = false;

  // TODO Warn if no hooks are used at all during mount, then some are used during update.
  // Currently we will identify the update render as a mount because memoizedState === null.
  // This is tricky because it's valid for certain types of components (e.g. React.lazy)
  // mount阶段没有hooks，而update阶段有hooks会报错

  // Using memoizedState to differentiate between mount/update only works if at least one stateful hook is used.
  // Non-stateful hooks (e.g. context) don't get added to memoizedState,
  // so memoizedState would be null during updates and mounts.
  // 使用hooks，用memoizedState来区分mount/update
  // 没有使用hooks，memoizedState为null

  if (__DEV__) {
    if (current !== null && current.memoizedState !== null) {
      ReactCurrentDispatcher.current = HooksDispatcherOnUpdateInDEV;
    } else if (hookTypesDev !== null) {
      // This dispatcher handles an edge case where a component is updating,
      // but no stateful hooks have been used.
      // We want to match the production code behavior (which will use HooksDispatcherOnMount),
      // but with the extra DEV validation to ensure hooks ordering hasn't changed.
      // This dispatcher does that.
      ReactCurrentDispatcher.current = HooksDispatcherOnMountWithHookTypesInDEV;
    } else {
      ReactCurrentDispatcher.current = HooksDispatcherOnMountInDEV;
    }
  } else {
    // 根据 是否有老currentFiber 设置ReactCurrentDispatcher.current，指向对应的hooks
    // hooks虽然都是一样使用，但是在 mount 和 update 中的hooks的内部实现是不同的
    ReactCurrentDispatcher.current =
      current === null || current.memoizedState === null
        ? HooksDispatcherOnMount
        : HooksDispatcherOnUpdate;
  }

  // 执行构造函数，返回构造函数return的结果，即子节点的reactElement对象
  // 这里会执行hooks相关方法
  let children = Component(props, secondArg);

  // Check if there was a render phase update
  // 检查是否有render阶段的update
  if (didScheduleRenderPhaseUpdateDuringThisPass) {
    // Keep rendering in a loop for as long as render phase updates continue to
    // be scheduled. Use a counter to prevent infinite loops.
    // 在调度render阶段的update过程中会持续render，使用计数器防止无限循环

    // reRender计数器
    let numberOfReRenders: number = 0;
    do {
      didScheduleRenderPhaseUpdateDuringThisPass = false;
      invariant(
        numberOfReRenders < RE_RENDER_LIMIT,
        'Too many re-renders. React limits the number of renders to prevent ' +
          'an infinite loop.',
      );

      numberOfReRenders += 1;
      if (__DEV__) {
        // Even when hot reloading, allow dependencies to stabilize
        // after first render to prevent infinite render phase updates.
        ignorePreviousDependencies = false;
      }

      // Start over from the beginning of the list
      currentHook = null;
      workInProgressHook = null;

      workInProgress.updateQueue = null;

      if (__DEV__) {
        // Also validate hook order for cascading updates.
        hookTypesUpdateIndexDev = -1;
      }

      // 设置ReactCurrentDispatcher.current为render的hooks
      ReactCurrentDispatcher.current = __DEV__
        ? HooksDispatcherOnRerenderInDEV
        : HooksDispatcherOnRerender;

      // 执行构造函数，返回构造函数return的结果，即children
      // 这里会执行hooks相关方法
      children = Component(props, secondArg);
    } while (didScheduleRenderPhaseUpdateDuringThisPass);
  }

  // We can assume the previous dispatcher is always this one, since we set it
  // at the beginning of the render phase and there's no re-entrancy.
  // 设置ReactCurrentDispatcher.current为contextOnly的hooks、
  // 这个是恢复原来的dispatcher
  ReactCurrentDispatcher.current = ContextOnlyDispatcher;

  if (__DEV__) {
    workInProgress._debugHookTypes = hookTypesDev;
  }

  // This check uses currentHook so that it works the same in DEV and prod bundles.
  // hookTypesDev could catch more cases (e.g. context) but only in DEV bundles.
  // 保证currentHook在dev和prod下相同，只有在dev下才会捕获更多的情况
  const didRenderTooFewHooks =
    currentHook !== null && currentHook.next !== null;

  // 重置renderLanes和currentlyRenderingFiber
  renderLanes = NoLanes;
  currentlyRenderingFiber = (null: any);

  // 重置currentHook和workInProgressHook
  currentHook = null;
  workInProgressHook = null;

  if (__DEV__) {
    currentHookNameInDev = null;
    hookTypesDev = null;
    hookTypesUpdateIndexDev = -1;
  }

  // 设置didScheduleRenderPhaseUpdate为false
  didScheduleRenderPhaseUpdate = false;

  invariant(
    !didRenderTooFewHooks,
    'Rendered fewer hooks than expected. This may be caused by an accidental ' +
      'early return statement.',
  );

  return children;
}

// 复用current.updateQueue
// 清除passiveEffect和updateEffect副作用
// current的lanes移除lanes
export function bailoutHooks(
  current: Fiber,
  workInProgress: Fiber,
  lanes: Lanes,
) {
  workInProgress.updateQueue = current.updateQueue;
  workInProgress.flags &= ~(PassiveEffect | UpdateEffect);
  current.lanes = removeLanes(current.lanes, lanes);
}

export function resetHooksAfterThrow(): void {
  // We can assume the previous dispatcher is always this one, since we set it
  // at the beginning of the render phase and there's no re-entrancy.
  ReactCurrentDispatcher.current = ContextOnlyDispatcher;

  if (didScheduleRenderPhaseUpdate) {
    // There were render phase updates. These are only valid for this render
    // phase, which we are now aborting. Remove the updates from the queues so
    // they do not persist to the next render. Do not remove updates from hooks
    // that weren't processed.
    //
    // Only reset the updates from the queue if it has a clone. If it does
    // not have a clone, that means it wasn't processed, and the updates were
    // scheduled before we entered the render phase.
    let hook: Hook | null = currentlyRenderingFiber.memoizedState;
    while (hook !== null) {
      const queue = hook.queue;
      if (queue !== null) {
        queue.pending = null;
      }
      hook = hook.next;
    }
    didScheduleRenderPhaseUpdate = false;
  }

  renderLanes = NoLanes;
  currentlyRenderingFiber = (null: any);

  currentHook = null;
  workInProgressHook = null;

  if (__DEV__) {
    hookTypesDev = null;
    hookTypesUpdateIndexDev = -1;

    currentHookNameInDev = null;

    isUpdatingOpaqueValueInRenderPhase = false;
  }

  didScheduleRenderPhaseUpdateDuringThisPass = false;
}

// 新建一个hook对象，将这个hook对象添加到workInProgressHook的最后
// currentlyRenderingFiber.memoizedState指向workInProgressHook链表的首个hook
// 返回指向当前hook对象的workInProgressHook

// workInProgressHook是按照先后顺序存放的，所以每次render的顺序变了就会出错
// 必须保证每次render中的hooks调用完全一样(顺序和类型都相同)
// 这也就是workInProgressHook不能放在判断嵌套中的原因
function mountWorkInProgressHook(): Hook {
  // memoizedState 存储当前值
  // baseState 存储初始值
  // next 连接下一个hook对象，形成单链表
  const hook: Hook = {
    memoizedState: null, // 存储当前值

    baseState: null,
    baseQueue: null,
    queue: null,

    next: null,
  };

  if (workInProgressHook === null) {
    // This is the first hook in the list
    // currentlyRenderingFiber.memoizedState指向workInProgressHook链表的首个hook对象
    currentlyRenderingFiber.memoizedState = workInProgressHook = hook;
  } else {
    // Append to the end of the list
    workInProgressHook = workInProgressHook.next = hook;
  }
  return workInProgressHook;
}

// 获取下一个workInProgressHook
// workInProgressHook是链表结构
// 调用hooks时按顺序依次取链表中的hook，这里每次render的顺序必须一致
// 如果currentlyRenderingFiber上有当前hook对象，直接取出返回
// 如果没有，取currentlyRenderingFiber对应的currentFiber上的当前hook对象，拷贝一个新的hook对象添加到workInProgressHook末尾并返回
function updateWorkInProgressHook(): Hook {
  // This function is used both for updates and for re-renders triggered by a
  // render phase update. It assumes there is either a current hook we can
  // clone, or a work-in-progress hook from a previous render pass that we can
  // use as a base. When we reach the end of the base list, we must switch to
  // the dispatcher used for mounts.
  let nextCurrentHook: null | Hook;
  // 获取下一个current hook
  if (currentHook === null) {
    // 当前rendering的workInProgress对应的currentFiber
    const current = currentlyRenderingFiber.alternate;
    if (current !== null) {
      // currentFiber.memoizedState指向下一个currentFiberHook的首个hook对象
      nextCurrentHook = current.memoizedState;
    } else {
      nextCurrentHook = null;
    }
  } else {
    nextCurrentHook = currentHook.next;
  }

  // 获取下一个workInProgress hook
  let nextWorkInProgressHook: null | Hook;
  // 设置nextWorkInProgressHook，之后赋给workInProgressHook
  if (workInProgressHook === null) {
    // workInProgress.memoizedState指向workInProgressHook链表的首个hook对象
    nextWorkInProgressHook = currentlyRenderingFiber.memoizedState;
  } else {
    nextWorkInProgressHook = workInProgressHook.next;
  }

  // 如果currentlyRenderingFiber上有当前hook对象，直接取出返回
  // 如果没有，取currentlyRenderingFiber对应的currentFiber上的当前hook对象，拷贝一个新的hook对象添加到workInProgressHook末尾并返回
  if (nextWorkInProgressHook !== null) {
    // There's already a work-in-progress. Reuse it.
    // 还有下一个workInProgress hook，指向下一个
    workInProgressHook = nextWorkInProgressHook;
    nextWorkInProgressHook = workInProgressHook.next;

    currentHook = nextCurrentHook;
  } else {
    // Clone from the current hook.
    // 没有下一个workInProgress hook，创建新的hook添加到workInProgressHook末尾

    invariant(
      nextCurrentHook !== null,
      'Rendered more hooks than during the previous render.',
    );
    currentHook = nextCurrentHook;

    const newHook: Hook = {
      memoizedState: currentHook.memoizedState,

      baseState: currentHook.baseState,
      baseQueue: currentHook.baseQueue,
      queue: currentHook.queue,

      next: null,
    };

    // 添加newHook到workInProgressHook末尾
    if (workInProgressHook === null) {
      // This is the first hook in the list.
      currentlyRenderingFiber.memoizedState = workInProgressHook = newHook;
    } else {
      // Append to the end of the list.
      workInProgressHook = workInProgressHook.next = newHook;
    }
  }
  return workInProgressHook;
}

function createFunctionComponentUpdateQueue(): FunctionComponentUpdateQueue {
  return {
    lastEffect: null,
  };
}

// 返回action函数的返回值或者action
// setNumber(xxx) 这里的xxx可能是number，也可以是function，对应这里的action
// 将其处理成number，再返回
// setNumber(1)
// setNumber((preNumber) => { return newNumber })
function basicStateReducer<S>(state: S, action: BasicStateAction<S>): S {
  // $FlowFixMe: Flow doesn't like mixed types
  return typeof action === 'function' ? action(state) : action;
}

// 首次渲染useReducer
// 逻辑与mountState类似，这里是手动传入reducer
function mountReducer<S, I, A>(
  reducer: (S, A) => S,
  initialArg: I, // 初始值
  init?: I => S, // 若传入这个，初始值会被设为init(initialArg)
): [S, Dispatch<A>] {
  // 新建一个hook对象，将这个hook对象添加到workInProgressHook的最后
  // currentlyRenderingFiber.memoizedState指向workInProgressHook链表的首个hook
  // 返回指向当前hook对象的workInProgressHook
  const hook = mountWorkInProgressHook();
  let initialState;
  // 获取初始值
  if (init !== undefined) {
    initialState = init(initialArg);
  } else {
    initialState = ((initialArg: any): S);
  }
  // 设置当前值和初始值
  hook.memoizedState = hook.baseState = initialState;
  // 状态更新队列 hook.queue
  const queue = (hook.queue = {
    pending: null,
    dispatch: null,
    lastRenderedReducer: reducer,
    lastRenderedState: (initialState: any),
  });
  const dispatch: Dispatch<A> = (queue.dispatch = (dispatchAction.bind(
    null,
    currentlyRenderingFiber,
    queue,
  ): any));
  return [hook.memoizedState, dispatch];
}

// 返回[新的newState, 和之前一样的dispatch]
function updateReducer<S, I, A>(
  reducer: (S, A) => S,
  initialArg: I,
  init?: I => S,
): [S, Dispatch<A>] {
  // 获取下一个workInProgressHook，也就是调用hook语法的时候，拿到链表workInProgressHook中 当前hook语法 对应的hook对象
  // workInProgressHook是链表结构
  // 调用hooks时按顺序依次取链表中的hook，这里每次render的顺序必须一致
  // 如果currentlyRenderingFiber上有当前hook对象，直接取出返回
  // 如果没有，取currentlyRenderingFiber对应的currentFiber上的当前hook对象，拷贝一个新的hook对象添加到workInProgressHook末尾并返回
  const hook = updateWorkInProgressHook();
  // hook对应的queue
  const queue = hook.queue;
  invariant(
    queue !== null,
    'Should have a queue. This is likely a bug in React. Please file an issue.',
  );

  // reducer  basicStateReducer
  // function basicStateReducer<S>(state: S, action: BasicStateAction<S>): S {
  //   return typeof action === 'function' ? action(state) : action;
  // }
  queue.lastRenderedReducer = reducer;

  const current: Hook = (currentHook: any);

  // The last rebase update that is NOT part of the base state.
  let baseQueue = current.baseQueue;

  // The last pending update that hasn't been processed yet.
  // queue.pending存放的是需要更新的update对象的循环单链表
  const pendingQueue = queue.pending;
  if (pendingQueue !== null) {
    // We have new updates that haven't been processed yet.
    // We'll add them to the base queue.
    // 有需要更新的内容，

    // currentHook.baseQueue 存放 pendingQueue => baseQueue => 循环 循环单链表
    // hook.queue.pending 存放 baseQueue => pendingQueue => 循环 循环单链表
    if (baseQueue !== null) {
      // Merge the pending queue and the base queue.
      // 合并pendingQueue到baseQueue末尾
      // 合并baseQueue到pendingQueue末尾
      const baseFirst = baseQueue.next;
      const pendingFirst = pendingQueue.next;
      baseQueue.next = pendingFirst;
      pendingQueue.next = baseFirst;
    }
    if (__DEV__) {
      if (current.baseQueue !== baseQueue) {
        // Internal invariant that should never happen, but feasibly could in
        // the future if we implement resuming, or some form of that.
        console.error(
          'Internal error: Expected work-in-progress queue to be a clone. ' +
            'This is a bug in React.',
        );
      }
    }
    // current.baseQueu最终存储 baseQueue => pendingQueue => 循环 循环单链表
    current.baseQueue = baseQueue = pendingQueue;
    // 清空 hook.queue.pending
    queue.pending = null;
  }

  if (baseQueue !== null) {
    // We have a queue to process.
    const first = baseQueue.next;
    // currentHook的当前值
    let newState = current.baseState;

    let newBaseState = null;
    let newBaseQueueFirst = null;
    let newBaseQueueLast = null;
    let update = first;
    // 遍历baseQueue + pendingQueue队列，获取最终的newState
    // 允许多次dispatch同一个值，每一次dispatch会在pendingQueue新创建一个update，在这里统一遍历
    do {
      const updateLane = update.lane;
      if (!isSubsetOfLanes(renderLanes, updateLane)) {
        // Priority is insufficient. Skip this update. If this is the first
        // skipped update, the previous update/state is the new base
        // update/state.
        // renderLanes & updateLane !== updateLane => 优先级不足

        // 克隆一个update
        const clone: Update<S, A> = {
          lane: updateLane,
          action: update.action,
          eagerReducer: update.eagerReducer,
          eagerState: update.eagerState,
          next: (null: any),
        };
        // 将新克隆的update放在newBaseQueue最后
        if (newBaseQueueLast === null) {
          // 遍历第一个update
          newBaseQueueFirst = newBaseQueueLast = clone;
          newBaseState = newState;
        } else {
          // 遍历后续update
          newBaseQueueLast = newBaseQueueLast.next = clone;
        }
        // Update the remaining priority in the queue.
        // TODO: Don't need to accumulate this. Instead, we can remove
        // renderLanes from the original lanes.
        // 把这个baseQueue上每个update的更新lane统一累加到currentlyRenderingFiber上，做统一更新
        // 所以每个update的更新lane可以跳过

        // 将updateLane累加到currentlyRenderingFiber.lanes上
        currentlyRenderingFiber.lanes = mergeLanes(
          currentlyRenderingFiber.lanes,
          updateLane,
        );
        // 标记跳过更新lanes updateLane
        markSkippedUpdateLanes(updateLane);
      } else {
        // This update does have sufficient priority.
        // renderLanes & updateLane !== updateLane => 有足够的优先级

        if (newBaseQueueLast !== null) {
          // 非首个update

          // 克隆一个update，将lane设为0，这样check过程就不会被跳过
          const clone: Update<S, A> = {
            // This update is going to be committed so we never want uncommit
            // it. Using NoLane works because 0 is a subset of all bitmasks, so
            // this will never be skipped by the check above.
            lane: NoLane,
            action: update.action,
            eagerReducer: update.eagerReducer,
            eagerState: update.eagerState,
            next: (null: any),
          };
          newBaseQueueLast = newBaseQueueLast.next = clone;
        }

        // Process this update.
        if (update.eagerReducer === reducer) {
          // If this update was processed eagerly, and its reducer matches the
          // current reducer, we can use the eagerly computed state.
          // 已经被处理过了，直接用处理过的值
          // 这里的值是在dispatch过程中更新的，暂存在update中
          newState = ((update.eagerState: any): S);
        } else {
          // 还没被处理，这里进行处理生成newState
          const action = update.action;
          newState = reducer(newState, action);
        }
      }
      update = update.next;
    } while (update !== null && update !== first);

    if (newBaseQueueLast === null) {
      newBaseState = newState;
    } else {
      // 循环???
      newBaseQueueLast.next = (newBaseQueueFirst: any);
    }

    // Mark that the fiber performed work, but only if the new state is
    // different from the current state.
    // 新老state不同时，标记需要接收更新
    // hook.memoizedState存放的当前值
    if (!is(newState, hook.memoizedState)) {
      // didReceiveUpdate设为true，标记当前workInProgress需要接收更新
      // 标记之后后续一定会走reconcileChildren逻辑render
      markWorkInProgressReceivedUpdate();
    }

    // 更新hook的memoizedState baseState baseQueue lastRenderedState
    hook.memoizedState = newState;
    hook.baseState = newBaseState;
    hook.baseQueue = newBaseQueueLast;

    queue.lastRenderedState = newState;
  }

  const dispatch: Dispatch<A> = (queue.dispatch: any);
  // 返回新值以及dispatch，返回新值之后继续执行函数组件的构造函数，最终以新值生成组件的根节点reactElement对象作为nextChildren
  return [hook.memoizedState, dispatch];
}

function rerenderReducer<S, I, A>(
  reducer: (S, A) => S,
  initialArg: I,
  init?: I => S,
): [S, Dispatch<A>] {
  const hook = updateWorkInProgressHook();
  const queue = hook.queue;
  invariant(
    queue !== null,
    'Should have a queue. This is likely a bug in React. Please file an issue.',
  );

  queue.lastRenderedReducer = reducer;

  // This is a re-render. Apply the new render phase updates to the previous
  // work-in-progress hook.
  const dispatch: Dispatch<A> = (queue.dispatch: any);
  const lastRenderPhaseUpdate = queue.pending;
  let newState = hook.memoizedState;
  if (lastRenderPhaseUpdate !== null) {
    // The queue doesn't persist past this render pass.
    queue.pending = null;

    const firstRenderPhaseUpdate = lastRenderPhaseUpdate.next;
    let update = firstRenderPhaseUpdate;
    do {
      // Process this render phase update. We don't have to check the
      // priority because it will always be the same as the current
      // render's.
      const action = update.action;
      newState = reducer(newState, action);
      update = update.next;
    } while (update !== firstRenderPhaseUpdate);

    // Mark that the fiber performed work, but only if the new state is
    // different from the current state.
    if (!is(newState, hook.memoizedState)) {
      markWorkInProgressReceivedUpdate();
    }

    hook.memoizedState = newState;
    // Don't persist the state accumulated from the render phase updates to
    // the base state unless the queue is empty.
    // TODO: Not sure if this is the desired semantics, but it's what we
    // do for gDSFP. I can't remember why.
    if (hook.baseQueue === null) {
      hook.baseState = newState;
    }

    queue.lastRenderedState = newState;
  }
  return [newState, dispatch];
}

type MutableSourceMemoizedState<Source, Snapshot> = {|
  refs: {
    getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
    setSnapshot: Snapshot => void,
  },
  source: MutableSource<any>,
  subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
|};

function readFromUnsubcribedMutableSource<Source, Snapshot>(
  root: FiberRoot,
  source: MutableSource<Source>,
  getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
): Snapshot {
  if (__DEV__) {
    warnAboutMultipleRenderersDEV(source);
  }

  const getVersion = source._getVersion;
  const version = getVersion(source._source);

  // Is it safe for this component to read from this source during the current render?
  let isSafeToReadFromSource = false;

  // Check the version first.
  // If this render has already been started with a specific version,
  // we can use it alone to determine if we can safely read from the source.
  const currentRenderVersion = getWorkInProgressVersion(source);
  if (currentRenderVersion !== null) {
    // It's safe to read if the store hasn't been mutated since the last time
    // we read something.
    isSafeToReadFromSource = currentRenderVersion === version;
  } else {
    // If there's no version, then this is the first time we've read from the
    // source during the current render pass, so we need to do a bit more work.
    // What we need to determine is if there are any hooks that already
    // subscribed to the source, and if so, whether there are any pending
    // mutations that haven't been synchronized yet.
    //
    // If there are no pending mutations, then `root.mutableReadLanes` will be
    // empty, and we know we can safely read.
    //
    // If there *are* pending mutations, we may still be able to safely read
    // if the currently rendering lanes are inclusive of the pending mutation
    // lanes, since that guarantees that the value we're about to read from
    // the source is consistent with the values that we read during the most
    // recent mutation.
    isSafeToReadFromSource = isSubsetOfLanes(
      renderLanes,
      root.mutableReadLanes,
    );

    if (isSafeToReadFromSource) {
      // If it's safe to read from this source during the current render,
      // store the version in case other components read from it.
      // A changed version number will let those components know to throw and restart the render.
      setWorkInProgressVersion(source, version);
    }
  }

  if (isSafeToReadFromSource) {
    const snapshot = getSnapshot(source._source);
    if (__DEV__) {
      if (typeof snapshot === 'function') {
        console.error(
          'Mutable source should not return a function as the snapshot value. ' +
            'Functions may close over mutable values and cause tearing.',
        );
      }
    }
    return snapshot;
  } else {
    // This handles the special case of a mutable source being shared between renderers.
    // In that case, if the source is mutated between the first and second renderer,
    // The second renderer don't know that it needs to reset the WIP version during unwind,
    // (because the hook only marks sources as dirty if it's written to their WIP version).
    // That would cause this tear check to throw again and eventually be visible to the user.
    // We can avoid this infinite loop by explicitly marking the source as dirty.
    //
    // This can lead to tearing in the first renderer when it resumes,
    // but there's nothing we can do about that (short of throwing here and refusing to continue the render).
    markSourceAsDirty(source);

    invariant(
      false,
      'Cannot read from mutable source during the current render without tearing. This is a bug in React. Please file an issue.',
    );
  }
}

function useMutableSource<Source, Snapshot>(
  hook: Hook,
  source: MutableSource<Source>,
  getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
  subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
): Snapshot {
  const root = ((getWorkInProgressRoot(): any): FiberRoot);
  invariant(
    root !== null,
    'Expected a work-in-progress root. This is a bug in React. Please file an issue.',
  );

  const getVersion = source._getVersion;
  const version = getVersion(source._source);

  const dispatcher = ReactCurrentDispatcher.current;

  // eslint-disable-next-line prefer-const
  let [currentSnapshot, setSnapshot] = dispatcher.useState(() =>
    readFromUnsubcribedMutableSource(root, source, getSnapshot),
  );
  let snapshot = currentSnapshot;

  // Grab a handle to the state hook as well.
  // We use it to clear the pending update queue if we have a new source.
  const stateHook = ((workInProgressHook: any): Hook);

  const memoizedState = ((hook.memoizedState: any): MutableSourceMemoizedState<
    Source,
    Snapshot,
  >);
  const refs = memoizedState.refs;
  const prevGetSnapshot = refs.getSnapshot;
  const prevSource = memoizedState.source;
  const prevSubscribe = memoizedState.subscribe;

  const fiber = currentlyRenderingFiber;

  hook.memoizedState = ({
    refs,
    source,
    subscribe,
  }: MutableSourceMemoizedState<Source, Snapshot>);

  // Sync the values needed by our subscription handler after each commit.
  dispatcher.useEffect(() => {
    refs.getSnapshot = getSnapshot;

    // Normally the dispatch function for a state hook never changes,
    // but this hook recreates the queue in certain cases  to avoid updates from stale sources.
    // handleChange() below needs to reference the dispatch function without re-subscribing,
    // so we use a ref to ensure that it always has the latest version.
    refs.setSnapshot = setSnapshot;

    // Check for a possible change between when we last rendered now.
    const maybeNewVersion = getVersion(source._source);
    if (!is(version, maybeNewVersion)) {
      const maybeNewSnapshot = getSnapshot(source._source);
      if (__DEV__) {
        if (typeof maybeNewSnapshot === 'function') {
          console.error(
            'Mutable source should not return a function as the snapshot value. ' +
              'Functions may close over mutable values and cause tearing.',
          );
        }
      }

      if (!is(snapshot, maybeNewSnapshot)) {
        setSnapshot(maybeNewSnapshot);

        const lane = requestUpdateLane(fiber);
        markRootMutableRead(root, lane);
      }
      // If the source mutated between render and now,
      // there may be state updates already scheduled from the old source.
      // Entangle the updates so that they render in the same batch.
      markRootEntangled(root, root.mutableReadLanes);
    }
  }, [getSnapshot, source, subscribe]);

  // If we got a new source or subscribe function, re-subscribe in a passive effect.
  dispatcher.useEffect(() => {
    const handleChange = () => {
      const latestGetSnapshot = refs.getSnapshot;
      const latestSetSnapshot = refs.setSnapshot;

      try {
        latestSetSnapshot(latestGetSnapshot(source._source));

        // Record a pending mutable source update with the same expiration time.
        const lane = requestUpdateLane(fiber);

        markRootMutableRead(root, lane);
      } catch (error) {
        // A selector might throw after a source mutation.
        // e.g. it might try to read from a part of the store that no longer exists.
        // In this case we should still schedule an update with React.
        // Worst case the selector will throw again and then an error boundary will handle it.
        latestSetSnapshot(
          (() => {
            throw error;
          }: any),
        );
      }
    };

    const unsubscribe = subscribe(source._source, handleChange);
    if (__DEV__) {
      if (typeof unsubscribe !== 'function') {
        console.error(
          'Mutable source subscribe function must return an unsubscribe function.',
        );
      }
    }

    return unsubscribe;
  }, [source, subscribe]);

  // If any of the inputs to useMutableSource change, reading is potentially unsafe.
  //
  // If either the source or the subscription have changed we can't can't trust the update queue.
  // Maybe the source changed in a way that the old subscription ignored but the new one depends on.
  //
  // If the getSnapshot function changed, we also shouldn't rely on the update queue.
  // It's possible that the underlying source was mutated between the when the last "change" event fired,
  // and when the current render (with the new getSnapshot function) is processed.
  //
  // In both cases, we need to throw away pending updates (since they are no longer relevant)
  // and treat reading from the source as we do in the mount case.
  if (
    !is(prevGetSnapshot, getSnapshot) ||
    !is(prevSource, source) ||
    !is(prevSubscribe, subscribe)
  ) {
    // Create a new queue and setState method,
    // So if there are interleaved updates, they get pushed to the older queue.
    // When this becomes current, the previous queue and dispatch method will be discarded,
    // including any interleaving updates that occur.
    const newQueue = {
      pending: null,
      dispatch: null,
      lastRenderedReducer: basicStateReducer,
      lastRenderedState: snapshot,
    };
    newQueue.dispatch = setSnapshot = (dispatchAction.bind(
      null,
      currentlyRenderingFiber,
      newQueue,
    ): any);
    stateHook.queue = newQueue;
    stateHook.baseQueue = null;
    snapshot = readFromUnsubcribedMutableSource(root, source, getSnapshot);
    stateHook.memoizedState = stateHook.baseState = snapshot;
  }

  return snapshot;
}

function mountMutableSource<Source, Snapshot>(
  source: MutableSource<Source>,
  getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
  subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
): Snapshot {
  const hook = mountWorkInProgressHook();
  hook.memoizedState = ({
    refs: {
      getSnapshot,
      setSnapshot: (null: any),
    },
    source,
    subscribe,
  }: MutableSourceMemoizedState<Source, Snapshot>);
  return useMutableSource(hook, source, getSnapshot, subscribe);
}

function updateMutableSource<Source, Snapshot>(
  source: MutableSource<Source>,
  getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
  subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
): Snapshot {
  const hook = updateWorkInProgressHook();
  return useMutableSource(hook, source, getSnapshot, subscribe);
}

// [number, setNumber] = useState('')
// [number, setNumber] = useState(()=>{})
// 创建hook，hook.memoizedState存放当前值
// 调用dispatch将更新结果存放在hook.queue.pending.update中，后续再render和commit
// hook则存放在currentlyRenderingFiber.memoizedState中
function mountState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  // 新建一个hook对象，将这个hook对象添加到workInProgressHook的最后
  // currentlyRenderingFiber.memoizedState指向workInProgressHook链表的首个hook
  // 返回指向当前hook对象的workInProgressHook
  const hook = mountWorkInProgressHook();
  // useState可以传入回调，初值就是回调的返回值
  if (typeof initialState === 'function') {
    // $FlowFixMe: Flow doesn't like mixed types
    initialState = initialState();
  }
  // hook.memoizedState 存储当前值，当前值每次调用dispatch就会改变
  // hook.baseState 存储初始值，初始值设置之后不会变
  hook.memoizedState = hook.baseState = initialState;
  // hook.queue.pending 与 类组件的workInProgress.updateQueue.shared.pending 作用相同
  // 是存放 dispatch(类组件是setState) 的更新内容对应的update对象的单链表结构
  const queue = (hook.queue = {
    pending: null,
    dispatch: null, // 存储暴露出去的dispatch方法
    lastRenderedReducer: basicStateReducer,
    lastRenderedState: (initialState: any),
  });
  // 生成dispatch，用于修改memoizedState
  // 执行dispatch，会把新的reducer和state更新到hook.queue.pending.update中
  // hook是存放在currentlyRenderingFiber.memoizedState中的workInProgressHook单链表中
  const dispatch: Dispatch<
    BasicStateAction<S>,
  > = (queue.dispatch = (dispatchAction.bind(
    null,
    currentlyRenderingFiber, // 当前正在渲染的fiber
    queue, // hook.queue
  ): any));
  return [hook.memoizedState, dispatch];
}

// [number, setNumber] = useState('')
// [number, setNumber] = useState(()=>{})
// setNumber(0)
// setNumber(preNum => 0)
function updateState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  return updateReducer(basicStateReducer, (initialState: any));
}

function rerenderState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  return rerenderReducer(basicStateReducer, (initialState: any));
}

// tag  HookHasEffect | HookPassive
// create useEffect的回调函数
// destroy useEffect的回调函数的return函数
// deps 依赖项数组，不传则为null
// 创建新的effect对象放在当前workInProgress的updateQueue的循环单链表上，返回这个effect
// 这个effect对象用于描述这个useEffect的行为
// workInProgress.updateQueue.lastEffect 指向最后添加的effect对象，也就是最后一次执行的effect对象
// ABCDE => A => BA => CAB => DABC => EABCD
function pushEffect(tag, create, destroy, deps) {
  // 创建一个新的effect对象，这个effect对象用于描述这个useEffect的行为
  const effect: Effect = {
    tag, // HookHasEffect | HookPassive
    create, // useEffect的副作用回调
    destroy, // useEffect的回调函数的return函数
    deps, // 依赖项数组
    // Circular // next用于循环单链表
    next: (null: any),
  };
  // 当前正在渲染中的workInProgress的updateQueue
  let componentUpdateQueue: null | FunctionComponentUpdateQueue = (currentlyRenderingFiber.updateQueue: any);
  
  // componentUpdateQueue的顺序流程
  // ABCDE => A => BA => CAB => DABC => EABCD
  // componentUpdateQueue的lastEffect指向最后添加的effect对象，也就是最后一次执行的effect对象
  if (componentUpdateQueue === null) {
    // 生成新的updateQueue放在当前workInProgress的updateQueue上
    // { lastEffect: null }
    componentUpdateQueue = createFunctionComponentUpdateQueue();
    currentlyRenderingFiber.updateQueue = (componentUpdateQueue: any);
    componentUpdateQueue.lastEffect = effect.next = effect;
  } else {
    // 将effect添加到当前workInProgress的updateQueue的末尾
    const lastEffect = componentUpdateQueue.lastEffect;
    if (lastEffect === null) {
      componentUpdateQueue.lastEffect = effect.next = effect;
    } else {
      const firstEffect = lastEffect.next;
      lastEffect.next = effect;
      effect.next = firstEffect;
      componentUpdateQueue.lastEffect = effect;
    }
  }
  return effect;
}

let stackContainsErrorMessage: boolean | null = null;

function getCallerStackFrame(): string {
  const stackFrames = new Error('Error message').stack.split('\n');

  // Some browsers (e.g. Chrome) include the error message in the stack
  // but others (e.g. Firefox) do not.
  if (stackContainsErrorMessage === null) {
    stackContainsErrorMessage = stackFrames[0].includes('Error message');
  }

  return stackContainsErrorMessage
    ? stackFrames.slice(3, 4).join('\n')
    : stackFrames.slice(2, 3).join('\n');
}

// 创建ref对象，其current属性指向initialValue
// 这个ref对象存放在hook.memoizedState
// 如果initialValue是引用类型，那么ref.current将会总是指向最新的
// 但是initialValue引用类型数据的变化不会引起页面重新渲染
function mountRef<T>(initialValue: T): {|current: T|} {
  const hook = mountWorkInProgressHook();
  if (enableUseRefAccessWarning) {
    if (__DEV__) {
      // Support lazy initialization pattern shown in docs.
      // We need to store the caller stack frame so that we don't warn on subsequent renders.
      let hasBeenInitialized = initialValue != null;
      let lazyInitGetterStack = null;
      let didCheckForLazyInit = false;

      // Only warn once per component+hook.
      let didWarnAboutRead = false;
      let didWarnAboutWrite = false;

      let current = initialValue;
      const ref = {
        get current() {
          if (!hasBeenInitialized) {
            didCheckForLazyInit = true;
            lazyInitGetterStack = getCallerStackFrame();
          } else if (currentlyRenderingFiber !== null && !didWarnAboutRead) {
            if (
              lazyInitGetterStack === null ||
              lazyInitGetterStack !== getCallerStackFrame()
            ) {
              didWarnAboutRead = true;
              console.warn(
                '%s: Unsafe read of a mutable value during render.\n\n' +
                  'Reading from a ref during render is only safe if:\n' +
                  '1. The ref value has not been updated, or\n' +
                  '2. The ref holds a lazily-initialized value that is only set once.\n',
                getComponentName(currentlyRenderingFiber.type) || 'Unknown',
              );
            }
          }
          return current;
        },
        set current(value) {
          if (currentlyRenderingFiber !== null && !didWarnAboutWrite) {
            if (
              hasBeenInitialized ||
              (!hasBeenInitialized && !didCheckForLazyInit)
            ) {
              didWarnAboutWrite = true;
              console.warn(
                '%s: Unsafe write of a mutable value during render.\n\n' +
                  'Writing to a ref during render is only safe if the ref holds ' +
                  'a lazily-initialized value that is only set once.\n',
                getComponentName(currentlyRenderingFiber.type) || 'Unknown',
              );
            }
          }

          hasBeenInitialized = true;
          current = value;
        },
      };
      Object.seal(ref);
      hook.memoizedState = ref;
      return ref;
    } else {
      const ref = {current: initialValue};
      hook.memoizedState = ref;
      return ref;
    }
  } else {
    const ref = {current: initialValue};
    hook.memoizedState = ref;
    return ref;
  }
}

// 返回hook.memoizedState上的ref对象
function updateRef<T>(initialValue: T): {|current: T|} {
  const hook = updateWorkInProgressHook();
  return hook.memoizedState;
}

// fiberFlags  UpdateEffect | PassiveEffect(useEffect) / UpdateEffect(useLayoutEffect)
// hookFlags  HookPassive(useEffect) / HookLayout(useLayoutEffect)
// create useEffect的回调函数
// deps 依赖项数组
// 创建新的hook对应useEffect
// 创建新的effect对象放在当前workInProgress的updateQueue的循环单链表上
// ABCDE => A => BA => CAB => DABC => EABCD
// hook.memoizedState存放这个effect对象，这个effect对象用于描述这个useEffect的行为
function mountEffectImpl(fiberFlags, hookFlags, create, deps): void {
  // 创建一个新的hook对象，存放在workInProgressHook链表最后，返回当前hook对象
  const hook = mountWorkInProgressHook();
  // 依赖项数组，不传就为null
  const nextDeps = deps === undefined ? null : deps;
  // 当前rendering workInProgress加上update和passive副作用
  currentlyRenderingFiber.flags |= fiberFlags;
  // 创建新的effect对象放在当前workInProgress的updateQueue的循环单链表上，返回这个effect
  // workInProgress.updateQueue.lastEffect 指向最后添加的effect对象，也就是最后一次执行的effect对象
  // ABCDE => A => BA => CAB => DABC => EABCD
  // hook.memoizedState存放这个effect对象
  // 这个effect对象用于描述这个useEffect的行为
  // mount阶段不会执行useEffect的回调函数生成destroy函数，等到执行回调的时候才会生成
  hook.memoizedState = pushEffect(
    HookHasEffect | hookFlags, // HookHasEffect | HookPassive(useEffect) / HookHasEffect | HookLayout(useLayoutEffect)
    create,
    undefined,
    nextDeps,
  );
}

// fiberFlags  UpdateEffect | PassiveEffect(useEffect) / UpdateEffect(useLayoutEffect)
// hookFlags  HookPassive(useEffect) / HookLayout(useLayoutEffect)
// create useEffect的回调函数
// deps 依赖项数组
// 获取对应的hook
// 创建新的effect对象放在当前workInProgress的updateQueue的末尾，返回这个effect
// hook.memoizedState存放这个effect对象
function updateEffectImpl(fiberFlags, hookFlags, create, deps): void {
  // 获取下一个workInProgressHook，也就是当前hook对象
  const hook = updateWorkInProgressHook();
  // 依赖项数组
  const nextDeps = deps === undefined ? null : deps;
  let destroy = undefined;

  if (currentHook !== null) {
    // 之前的effect对象，也就是上一轮useEffect设置的hook对象的对应的effect对象
    // 会在提交阶段生成对应的destroy函数
    const prevEffect = currentHook.memoizedState;
    destroy = prevEffect.destroy;
    // 有依赖项数组
    if (nextDeps !== null) {
      const prevDeps = prevEffect.deps;
      // 新老依赖项数组相同
      // 创建新的effect对象放在当前workInProgress的updateQueue对应的循环单链表上
      // 然后return，也就是不给当前currentlyRenderingFiber添加副作用，那提交阶段就不会直接这个useEffect回调
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        pushEffect(hookFlags, create, destroy, nextDeps); // HookPassive
        return;
      }
    }
  }

  // 这里的情况是 currentHook为null || 没有依赖项数组 || 新老依赖项数组不同

  // 当前渲染中的workInProgress加上update和passive副作用
  // 在提交阶段就会根据这个副作用执行useEffect的回调函数
  // 这里是和 依赖项不变的情况 不同的地方
  currentlyRenderingFiber.flags |= fiberFlags;

  // 创建新的effect对象放在当前workInProgress的updateQueue对应的循环单链表上
  hook.memoizedState = pushEffect(
    HookHasEffect | hookFlags, // HookHasEffect | HookPassive(useEffect) / HookHasEffect | HookLayout(useLayoutEffect)
    create,
    destroy,
    nextDeps,
  );
}

// 首次useEffect
// 创建新的hook对应useEffect
// 创建新的effect对象放在当前workInProgress的updateQueue的循环单链表上
// ABCDE => A => BA => CAB => DABC => EABCD
// hook.memoizedState存放这个effect对象，这个effect对象用于描述这个useEffect的行为
function mountEffect(
  create: () => (() => void) | void, // 副作用回调
  deps: Array<mixed> | void | null, // 依赖项数组
): void {
  if (__DEV__) {
    // $FlowExpectedError - jest isn't a global, and isn't recognized outside of tests
    if ('undefined' !== typeof jest) {
      warnIfNotCurrentlyActingEffectsInDEV(currentlyRenderingFiber);
    }
  }
  // 创建新的hook对应useEffect
  // 创建新的effect对象放在当前workInProgress的updateQueue的循环单链表上
  // ABCDE => A => BA => CAB => DABC => EABCD
  // hook.memoizedState存放这个effect对象，这个effect对象用于描述这个useEffect的行为
  // 这里带PassiveEffect标志，是要放在flushPassiveEffects中执行useEffect的副作用函数吗???
  return mountEffectImpl(
    UpdateEffect | PassiveEffect,
    HookPassive,
    create,
    deps,
  );
}

// 更新渲染执行useEffect
// 获取对应的hook
// 创建新的effect对象放在当前workInProgress的updateQueue的末尾，返回这个effect
// hook.memoizedState存放这个effect对象
// 这里带PassiveEffect标志，是要放在flushPassiveEffects中执行useEffect的副作用函数吗???
function updateEffect(
  create: () => (() => void) | void, // 副作用回调
  deps: Array<mixed> | void | null, // 依赖项数组
): void {
  if (__DEV__) {
    // $FlowExpectedError - jest isn't a global, and isn't recognized outside of tests
    if ('undefined' !== typeof jest) {
      warnIfNotCurrentlyActingEffectsInDEV(currentlyRenderingFiber);
    }
  }
  // 获取对应的hook
  // 创建新的effect对象放在当前workInProgress的updateQueue的末尾，返回这个effect
  // hook.memoizedState存放这个effect对象
  return updateEffectImpl(
    UpdateEffect | PassiveEffect,
    HookPassive,
    create,
    deps,
  );
}

// 与mountEffect不同的是fiberFlags和hookFlags
function mountLayoutEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  return mountEffectImpl(UpdateEffect, HookLayout, create, deps);
}

// 与updateEffect不同的是fiberFlags和hookFlags
function updateLayoutEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  return updateEffectImpl(UpdateEffect, HookLayout, create, deps);
}

// useImperativeHandle(ref, () => ({
//   focus: () => {
//     inputRef.current.focus()
//   }
// }))
// 这里的ref.current指向{focus: () => {inputRef.current.focus()}}，ref是父组件中传入的
// 所以ref.current.focus相当于执行了inputRef.current.focus
// 也就是父组件可以调用子组件中的inputRef.current.focus
// 如果ref为函数，则{focus: () => {inputRef.current.focus()}}就作为参数传入，执行ref函数
// useImperativeHandle可以通过return一个函数来实现卸载，同useEffect
function imperativeHandleEffect<T>(
  create: () => T,
  ref: {|current: T | null|} | ((inst: T | null) => mixed) | null | void,
) {
  if (typeof ref === 'function') {
    const refCallback = ref;
    const inst = create();
    refCallback(inst);
    return () => {
      refCallback(null);
    };
  } else if (ref !== null && ref !== undefined) {
    const refObject = ref;
    if (__DEV__) {
      if (!refObject.hasOwnProperty('current')) {
        console.error(
          'Expected useImperativeHandle() first argument to either be a ' +
            'ref callback or React.createRef() object. Instead received: %s.',
          'an object with keys {' + Object.keys(refObject).join(', ') + '}',
        );
      }
    }
    const inst = create();
    refObject.current = inst;
    return () => {
      refObject.current = null;
    };
  }
}

function mountImperativeHandle<T>(
  ref: {|current: T | null|} | ((inst: T | null) => mixed) | null | void,
  create: () => T,
  deps: Array<mixed> | void | null,
): void {
  if (__DEV__) {
    if (typeof create !== 'function') {
      console.error(
        'Expected useImperativeHandle() second argument to be a function ' +
          'that creates a handle. Instead received: %s.',
        create !== null ? typeof create : 'null',
      );
    }
  }

  // TODO: If deps are provided, should we skip comparing the ref itself?
  const effectDeps =
    deps !== null && deps !== undefined ? deps.concat([ref]) : null;

  return mountEffectImpl(
    UpdateEffect,
    HookLayout,
    imperativeHandleEffect.bind(null, create, ref),
    effectDeps,
  );
}

// useImperativeHandle
// useImperativeHandle(ref, () => ({
//   focus: () => {
//     inputRef.current.focus()
//   }
// }))
// 这里的ref.current指向{focus: () => {inputRef.current.focus()}}，ref是父组件中传入的
// 所以ref.current.focus相当于执行了inputRef.current.focus
// 也就是父组件可以调用子组件中的inputRef.current.focus
// 如果ref为函数，则{focus: () => {inputRef.current.focus()}}就作为参数传入，执行ref函数
// useImperativeHandle可以通过return一个函数来实现卸载，同useEffect
function updateImperativeHandle<T>(
  ref: {|current: T | null|} | ((inst: T | null) => mixed) | null | void,
  create: () => T,
  deps: Array<mixed> | void | null,
): void {
  if (__DEV__) {
    if (typeof create !== 'function') {
      console.error(
        'Expected useImperativeHandle() second argument to be a function ' +
          'that creates a handle. Instead received: %s.',
        create !== null ? typeof create : 'null',
      );
    }
  }

  // TODO: If deps are provided, should we skip comparing the ref itself?
  // ref添加到依赖项中
  const effectDeps =
    deps !== null && deps !== undefined ? deps.concat([ref]) : null;

  return updateEffectImpl(
    UpdateEffect,
    HookLayout,
    imperativeHandleEffect.bind(null, create, ref),
    effectDeps,
  );
}

function mountDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
  // This hook is normally a no-op.
  // The react-debug-hooks package injects its own implementation
  // so that e.g. DevTools can display custom hook values.
}

const updateDebugValue = mountDebugValue;

// 首次渲染useCallback
// hook.memoizedState存储callback和依赖项数组
function mountCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
  const hook = mountWorkInProgressHook();
  // 依赖项数组，不传则为null
  const nextDeps = deps === undefined ? null : deps;
  // hook.memoizedState存储callback和依赖项数组
  hook.memoizedState = [callback, nextDeps];
  return callback;
}

// 更新渲染useCallback
// 有缓存callback且新老依赖项不变，就直接返回缓存的callback
// 否则就重新缓存callback，逻辑同 mountCallback
function updateCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;
  // 有缓存callback且新老依赖项不变，就直接返回缓存的callback
  if (prevState !== null) {
    if (nextDeps !== null) {
      const prevDeps: Array<mixed> | null = prevState[1];
      // 依赖项不变，直接返回缓存的callback
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        return prevState[0];
      }
    }
  }
  // 走到这里，要么没有缓存值，要么依赖项发生变化，需要重新缓存callback
  // 下面的逻辑同 mountCallback
  hook.memoizedState = [callback, nextDeps];
  return callback;
}

// 首次渲染useMemo
// hook.memoizedState存放缓存值和依赖项数组
function mountMemo<T>(
  nextCreate: () => T,
  deps: Array<mixed> | void | null,
): T {
  // 新建一个hook对象，将这个hook对象添加到workInProgressHook的最后
  // currentlyRenderingFiber.memoizedState指向workInProgressHook链表的首个hook
  // 返回指向当前hook对象的workInProgressHook
  const hook = mountWorkInProgressHook();
  // 依赖项数组，不传则为null
  const nextDeps = deps === undefined ? null : deps;
  // 计算值并缓存
  const nextValue = nextCreate();
  // hook.memoizedState存放缓存值和依赖项数组
  hook.memoizedState = [nextValue, nextDeps];
  return nextValue;
}

// 更新渲染useMemo
// 有缓存值，且新老依赖项没有变化，直接返回缓存的值
// 否则，计算值并且进行缓存，逻辑同 mountMemo
function updateMemo<T>(
  nextCreate: () => T,
  deps: Array<mixed> | void | null,
): T {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  // [prevValue, prevDeps]
  const prevState = hook.memoizedState;
  // 有缓存值，且新老依赖项没有变化，直接返回缓存的值
  if (prevState !== null) {
    // Assume these are defined. If they're not, areHookInputsEqual will warn.
    if (nextDeps !== null) {
      const prevDeps: Array<mixed> | null = prevState[1];
      // 依赖项没有变化，直接返回缓存的值
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        return prevState[0];
      }
    }
  }
  // 走到这里，要么没有缓存值，要么依赖项发生变化，需要计算值并且进行缓存
  // 下面的逻辑同 mountMemo
  const nextValue = nextCreate();
  hook.memoizedState = [nextValue, nextDeps];
  return nextValue;
}

function mountDeferredValue<T>(value: T): T {
  const [prevValue, setValue] = mountState(value);
  mountEffect(() => {
    const prevTransition = ReactCurrentBatchConfig.transition;
    ReactCurrentBatchConfig.transition = 1;
    try {
      setValue(value);
    } finally {
      ReactCurrentBatchConfig.transition = prevTransition;
    }
  }, [value]);
  return prevValue;
}

function updateDeferredValue<T>(value: T): T {
  const [prevValue, setValue] = updateState(value);
  updateEffect(() => {
    const prevTransition = ReactCurrentBatchConfig.transition;
    ReactCurrentBatchConfig.transition = 1;
    try {
      setValue(value);
    } finally {
      ReactCurrentBatchConfig.transition = prevTransition;
    }
  }, [value]);
  return prevValue;
}

function rerenderDeferredValue<T>(value: T): T {
  const [prevValue, setValue] = rerenderState(value);
  updateEffect(() => {
    const prevTransition = ReactCurrentBatchConfig.transition;
    ReactCurrentBatchConfig.transition = 1;
    try {
      setValue(value);
    } finally {
      ReactCurrentBatchConfig.transition = prevTransition;
    }
  }, [value]);
  return prevValue;
}

function startTransition(setPending, callback) {
  const priorityLevel = getCurrentPriorityLevel();
  if (decoupleUpdatePriorityFromScheduler) {
    const previousLanePriority = getCurrentUpdateLanePriority();
    setCurrentUpdateLanePriority(
      higherLanePriority(previousLanePriority, InputContinuousLanePriority),
    );

    runWithPriority(
      priorityLevel < UserBlockingPriority
        ? UserBlockingPriority
        : priorityLevel,
      () => {
        setPending(true);
      },
    );

    // TODO: Can remove this. Was only necessary because we used to give
    // different behavior to transitions without a config object. Now they are
    // all treated the same.
    setCurrentUpdateLanePriority(DefaultLanePriority);

    runWithPriority(
      priorityLevel > NormalPriority ? NormalPriority : priorityLevel,
      () => {
        const prevTransition = ReactCurrentBatchConfig.transition;
        ReactCurrentBatchConfig.transition = 1;
        try {
          setPending(false);
          callback();
        } finally {
          if (decoupleUpdatePriorityFromScheduler) {
            setCurrentUpdateLanePriority(previousLanePriority);
          }
          ReactCurrentBatchConfig.transition = prevTransition;
        }
      },
    );
  } else {
    runWithPriority(
      priorityLevel < UserBlockingPriority
        ? UserBlockingPriority
        : priorityLevel,
      () => {
        setPending(true);
      },
    );

    runWithPriority(
      priorityLevel > NormalPriority ? NormalPriority : priorityLevel,
      () => {
        const prevTransition = ReactCurrentBatchConfig.transition;
        ReactCurrentBatchConfig.transition = 1;
        try {
          setPending(false);
          callback();
        } finally {
          ReactCurrentBatchConfig.transition = prevTransition;
        }
      },
    );
  }
}

function mountTransition(): [(() => void) => void, boolean] {
  const [isPending, setPending] = mountState(false);
  // The `start` method never changes.
  const start = startTransition.bind(null, setPending);
  const hook = mountWorkInProgressHook();
  hook.memoizedState = start;
  return [start, isPending];
}

function updateTransition(): [(() => void) => void, boolean] {
  const [isPending] = updateState(false);
  const hook = updateWorkInProgressHook();
  const start = hook.memoizedState;
  return [start, isPending];
}

function rerenderTransition(): [(() => void) => void, boolean] {
  const [isPending] = rerenderState(false);
  const hook = updateWorkInProgressHook();
  const start = hook.memoizedState;
  return [start, isPending];
}

let isUpdatingOpaqueValueInRenderPhase = false;
export function getIsUpdatingOpaqueValueInRenderPhaseInDEV(): boolean | void {
  if (__DEV__) {
    return isUpdatingOpaqueValueInRenderPhase;
  }
}

function warnOnOpaqueIdentifierAccessInDEV(fiber) {
  if (__DEV__) {
    // TODO: Should warn in effects and callbacks, too
    const name = getComponentName(fiber.type) || 'Unknown';
    if (getIsRendering() && !didWarnAboutUseOpaqueIdentifier[name]) {
      console.error(
        'The object passed back from useOpaqueIdentifier is meant to be ' +
          'passed through to attributes only. Do not read the ' +
          'value directly.',
      );
      didWarnAboutUseOpaqueIdentifier[name] = true;
    }
  }
}

function mountOpaqueIdentifier(): OpaqueIDType | void {
  const makeId = __DEV__
    ? makeClientIdInDEV.bind(
        null,
        warnOnOpaqueIdentifierAccessInDEV.bind(null, currentlyRenderingFiber),
      )
    : makeClientId;

  if (getIsHydrating()) {
    let didUpgrade = false;
    const fiber = currentlyRenderingFiber;
    const readValue = () => {
      if (!didUpgrade) {
        // Only upgrade once. This works even inside the render phase because
        // the update is added to a shared queue, which outlasts the
        // in-progress render.
        didUpgrade = true;
        if (__DEV__) {
          isUpdatingOpaqueValueInRenderPhase = true;
          setId(makeId());
          isUpdatingOpaqueValueInRenderPhase = false;
          warnOnOpaqueIdentifierAccessInDEV(fiber);
        } else {
          setId(makeId());
        }
      }
      invariant(
        false,
        'The object passed back from useOpaqueIdentifier is meant to be ' +
          'passed through to attributes only. Do not read the value directly.',
      );
    };
    const id = makeOpaqueHydratingObject(readValue);

    const setId = mountState(id)[1];

    if ((currentlyRenderingFiber.mode & BlockingMode) === NoMode) {
      currentlyRenderingFiber.flags |= UpdateEffect | PassiveEffect;
      pushEffect(
        HookHasEffect | HookPassive,
        () => {
          setId(makeId());
        },
        undefined,
        null,
      );
    }
    return id;
  } else {
    const id = makeId();
    mountState(id);
    return id;
  }
}

function updateOpaqueIdentifier(): OpaqueIDType | void {
  const id = updateState(undefined)[0];
  return id;
}

function rerenderOpaqueIdentifier(): OpaqueIDType | void {
  const id = rerenderState(undefined)[0];
  return id;
}

// [number, setNumber] = useState(1)
// [state, dispatch] = useReducer(reducer, initialState)
// 更新state，将更新结果包裹成update对象，存放在hook.queue.pending单链表上，用于后续的更新
// hook.queue.pending上的update对象循环单链表会在后续执行hooks时统一更新到newState
// dispatch => scheduleUpdateOnFiber => performUnitOfWork => beginWork => renderWithHooks => 执行构造函数 => 执行hooks => 更新state
// hook是存放在workInProgress.memoizedState上
// ABCDE => A => BA => CAB => DABC => EABCD
// 后续处理的时候会将queue.pending.next作为第一个
// useState和useReducer类似，不同的是useState使用的是basicStateReducer，而useReducer使用的是手动传入的reducer
function dispatchAction<S, A>(
  fiber: Fiber, // 当前render中的workInProgress currentlyRenderingFiber
  queue: UpdateQueue<S, A>, // 当前hook的queue
  // useState => setNumber(xxx)传入的参数 xxx，可能是新值，也可能是返回新值的回调函数
  // useReducer => dispatch({type: 'xxx'})的参数 {type: 'xxx'}
  action: A,
) {
  if (__DEV__) {
    if (typeof arguments[3] === 'function') {
      console.error(
        "State updates from the useState() and useReducer() Hooks don't support the " +
          'second callback argument. To execute a side effect after ' +
          'rendering, declare it in the component body with useEffect().',
      );
    }
  }

  // 获取程序执行到此时的时间currentEventTime
  const eventTime = requestEventTime();
  // 获取更新lane
  const lane = requestUpdateLane(fiber);

  // 创建update对象
  const update: Update<S, A> = {
    lane, // 更新lane
    action, // 新值 或 返回新值的回调函数
    eagerReducer: null, // basicStateReducer，用于将action处理成新值
    eagerState: null, // action处理后的新值
    next: (null: any),
  };

  // Append the update to the end of the list.
  // 将新创建的update放在queue.pending队列的最后
  // 这个步骤和setState相同，都是 ABCDE => A => BA => CAB => DABC => EABCD
  // 不同的是
  // useState的dispatch是将创建的update对象是存储在当前hook.queue.pending，而hook是以单链表的形式存储在currentlyRenderingFiber.memoizedState上
  // setState创建的update对象是存储在fiber.updateQueue.shared.pending
  const pending = queue.pending;
  if (pending === null) {
    // This is the first update. Create a circular list.
    // 建立循环
    update.next = update;
  } else {
    // 将pending添加到update后面，然后建立循环
    // 顺序 pending => update => pending.next => pending => ... 循环
    update.next = pending.next;
    pending.next = update;
  }
  // 将pending + update新生成的链表给到queue.pending
  // 顺序 update => pending.next => pending => update => ... 循环
  // ABCDE => A => BA => CAB => DABC => EABCD
  // 后续处理的时候会将queue.pending.next作为第一个
  queue.pending = update;

  // currentlyRenderingFiber对应的currentFiber
  const alternate = fiber.alternate;
  if (
    fiber === currentlyRenderingFiber ||
    (alternate !== null && alternate === currentlyRenderingFiber)
  ) {
    // This is a render phase update. Stash it in a lazily-created map of
    // queue -> linked list of updates. After this render pass, we'll restart
    // and apply the stashed updates on top of the work-in-progress hook.
    // 这其实就是判断这个更新是否是在渲染过程中产生的
    // currentlyRenderingFiber只有在FunctionalComponent更新的过程中才会被设置
    // 在离开更新的时候设置为null，所以只要存在并和产生更新的Fiber相等
    // 说明这个更新是在当前渲染中产生的，则这是一次reRender

    didScheduleRenderPhaseUpdateDuringThisPass = didScheduleRenderPhaseUpdate = true;
  } else {
    // 将新reduer和state更新到hook.queue.pending上的update对象
    // hook.queue.pending上的update对象循环单链表会在后续执行hooks时统一更新到newState
    // dispatch => scheduleUpdateOnFiber => performUnitOfWork => beginWork => renderWithHooks => 执行构造函数 => 执行hooks => 更新state
    if (
      fiber.lanes === NoLanes &&
      (alternate === null || alternate.lanes === NoLanes)
    ) {
      // The queue is currently empty, which means we can eagerly compute the
      // next state before entering the render phase. If the new state is the
      // same as the current state, we may be able to bail out entirely.
      // useState => basicStateReducer
      // useReducer => 手动传入的reducer
      const lastRenderedReducer = queue.lastRenderedReducer;
      if (lastRenderedReducer !== null) {
        let prevDispatcher;
        if (__DEV__) {
          prevDispatcher = ReactCurrentDispatcher.current;
          ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
        }
        try {
          // 当前值
          const currentState: S = (queue.lastRenderedState: any);
          // setNumber(xxx) 这里的 xxx 可能是number，也可以是function，对应这里的action
          // 将其处理成number，再返回
          // setNumber(1)
          // setNumber((preNumber) => { return newNumber })
          // eagerState 指向需要修改成的新state
          const eagerState = lastRenderedReducer(currentState, action);
          // Stash the eagerly computed state, and the reducer used to compute
          // it, on the update object. If the reducer hasn't changed by the
          // time we enter the render phase, then the eager state can be used
          // without calling the reducer again.

          // 更新update的eagerReducer和eagerState，而update是在queue.pending上
          // 这里将最新的reducer和state暂存在update上，在后续调用到hooks语法时会取出更新好的值，并标记需要接收更新
          // basicStateReducer 用于将传入的action处理成新值eagerState
          update.eagerReducer = lastRenderedReducer;
          // action处理之后的新值
          update.eagerState = eagerState;
          // eagerState和currentState为同一个值，即新老值相同，直接return
          if (is(eagerState, currentState)) {
            // Fast path. We can bail out without scheduling React to re-render.
            // It's still possible that we'll need to rebase this update later,
            // if the component re-renders for a different reason and by that
            // time the reducer has changed.
            return;
          }
        } catch (error) {
          // Suppress the error. It will throw again in the render phase.
        } finally {
          if (__DEV__) {
            ReactCurrentDispatcher.current = prevDispatcher;
          }
        }
      }
    }

    // 走到这里，说明新老值不同，需要更新
    // 同时，update对象已经处理完毕，而update对象存储在当前hook.queue.pending上
    // hook对象存储在单链表上(currentlyRenderingFiber.memoizedState)，每次按顺序调用
    // update.eagerReducer 指向basicStateReducer，用于将action处理成新值
    // update.eagerState 指向action处理后的新值

    if (__DEV__) {
      // $FlowExpectedError - jest isn't a global, and isn't recognized outside of tests
      if ('undefined' !== typeof jest) {
        warnIfNotScopedWithMatchingAct(fiber);
        warnIfNotCurrentlyActingUpdatesInDev(fiber);
      }
    }
    // fiber里的调度更新
    // 内部核心逻辑都是performSyncWorkOnRoot
    // performSyncWorkOnRoot 先执行同步工作renderRootSync，然后提交root
    // 此时，需要更新的内容已经放在hook.queue.pending新创建的update上了
    // hook是存放在workInProgress.memoizedState上
    scheduleUpdateOnFiber(fiber, lane, eventTime);
  }

  if (__DEV__) {
    if (enableDebugTracing) {
      if (fiber.mode & DebugTracingMode) {
        const name = getComponentName(fiber.type) || 'Unknown';
        logStateUpdateScheduled(name, lane, action);
      }
    }
  }

  // 标记schedule state update
  if (enableSchedulingProfiler) {
    markStateUpdateScheduled(fiber, lane);
  }
}

export const ContextOnlyDispatcher: Dispatcher = {
  readContext,

  useCallback: throwInvalidHookError,
  useContext: throwInvalidHookError,
  useEffect: throwInvalidHookError,
  useImperativeHandle: throwInvalidHookError,
  useLayoutEffect: throwInvalidHookError,
  useMemo: throwInvalidHookError,
  useReducer: throwInvalidHookError,
  useRef: throwInvalidHookError,
  useState: throwInvalidHookError,
  useDebugValue: throwInvalidHookError,
  useDeferredValue: throwInvalidHookError,
  useTransition: throwInvalidHookError,
  useMutableSource: throwInvalidHookError,
  useOpaqueIdentifier: throwInvalidHookError,

  unstable_isNewReconciler: enableNewReconciler,
};

// mount阶段的hooks
const HooksDispatcherOnMount: Dispatcher = {
  readContext,

  useCallback: mountCallback, // ok
  useContext: readContext, // ok
  useEffect: mountEffect, // ok
  useImperativeHandle: mountImperativeHandle, // ok
  useLayoutEffect: mountLayoutEffect, // ok
  useMemo: mountMemo, // ok
  useReducer: mountReducer, // ok
  useRef: mountRef, // ok
  useState: mountState, // ok
  useDebugValue: mountDebugValue,
  useDeferredValue: mountDeferredValue,
  useTransition: mountTransition,
  useMutableSource: mountMutableSource,
  useOpaqueIdentifier: mountOpaqueIdentifier,

  unstable_isNewReconciler: enableNewReconciler,
};

// update阶段的hooks
const HooksDispatcherOnUpdate: Dispatcher = {
  readContext,

  useCallback: updateCallback, // ok
  useContext: readContext, // ok
  useEffect: updateEffect, // ok
  useImperativeHandle: updateImperativeHandle, // ok
  useLayoutEffect: updateLayoutEffect, // ok
  useMemo: updateMemo, // ok
  useReducer: updateReducer, // ok
  useRef: updateRef, // ok
  useState: updateState, // ok
  useDebugValue: updateDebugValue,
  useDeferredValue: updateDeferredValue,
  useTransition: updateTransition,
  useMutableSource: updateMutableSource,
  useOpaqueIdentifier: updateOpaqueIdentifier,

  unstable_isNewReconciler: enableNewReconciler,
};

const HooksDispatcherOnRerender: Dispatcher = {
  readContext,

  useCallback: updateCallback,
  useContext: readContext,
  useEffect: updateEffect,
  useImperativeHandle: updateImperativeHandle,
  useLayoutEffect: updateLayoutEffect,
  useMemo: updateMemo,
  useReducer: rerenderReducer,
  useRef: updateRef,
  useState: rerenderState,
  useDebugValue: updateDebugValue,
  useDeferredValue: rerenderDeferredValue,
  useTransition: rerenderTransition,
  useMutableSource: updateMutableSource,
  useOpaqueIdentifier: rerenderOpaqueIdentifier,

  unstable_isNewReconciler: enableNewReconciler,
};

let HooksDispatcherOnMountInDEV: Dispatcher | null = null;
let HooksDispatcherOnMountWithHookTypesInDEV: Dispatcher | null = null;
let HooksDispatcherOnUpdateInDEV: Dispatcher | null = null;
let HooksDispatcherOnRerenderInDEV: Dispatcher | null = null;
let InvalidNestedHooksDispatcherOnMountInDEV: Dispatcher | null = null;
let InvalidNestedHooksDispatcherOnUpdateInDEV: Dispatcher | null = null;
let InvalidNestedHooksDispatcherOnRerenderInDEV: Dispatcher | null = null;

if (__DEV__) {
  const warnInvalidContextAccess = () => {
    console.error(
      'Context can only be read while React is rendering. ' +
        'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
        'In function components, you can read it directly in the function body, but not ' +
        'inside Hooks like useReducer() or useMemo().',
    );
  };

  const warnInvalidHookAccess = () => {
    console.error(
      'Do not call Hooks inside useEffect(...), useMemo(...), or other built-in Hooks. ' +
        'You can only call Hooks at the top level of your React function. ' +
        'For more information, see ' +
        'https://reactjs.org/link/rules-of-hooks',
    );
  };

  HooksDispatcherOnMountInDEV = {
    readContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      return readContext(context, observedBits);
    },
    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountCallback(callback, deps);
    },
    useContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      currentHookNameInDev = 'useContext';
      mountHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountEffect(create, deps);
    },
    useImperativeHandle<T>(
      ref: {|current: T | null|} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountLayoutEffect(create, deps);
    },
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef<T>(initialValue: T): {|current: T|} {
      currentHookNameInDev = 'useRef';
      mountHookTypesDev();
      return mountRef(initialValue);
    },
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      mountHookTypesDev();
      return mountDebugValue(value, formatterFn);
    },
    useDeferredValue<T>(value: T): T {
      currentHookNameInDev = 'useDeferredValue';
      mountHookTypesDev();
      return mountDeferredValue(value);
    },
    useTransition(): [(() => void) => void, boolean] {
      currentHookNameInDev = 'useTransition';
      mountHookTypesDev();
      return mountTransition();
    },
    useMutableSource<Source, Snapshot>(
      source: MutableSource<Source>,
      getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
      subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
    ): Snapshot {
      currentHookNameInDev = 'useMutableSource';
      mountHookTypesDev();
      return mountMutableSource(source, getSnapshot, subscribe);
    },
    useOpaqueIdentifier(): OpaqueIDType | void {
      currentHookNameInDev = 'useOpaqueIdentifier';
      mountHookTypesDev();
      return mountOpaqueIdentifier();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };

  HooksDispatcherOnMountWithHookTypesInDEV = {
    readContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      return readContext(context, observedBits);
    },
    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      updateHookTypesDev();
      return mountCallback(callback, deps);
    },
    useContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      currentHookNameInDev = 'useContext';
      updateHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      updateHookTypesDev();
      return mountEffect(create, deps);
    },
    useImperativeHandle<T>(
      ref: {|current: T | null|} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      updateHookTypesDev();
      return mountImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      updateHookTypesDev();
      return mountLayoutEffect(create, deps);
    },
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef<T>(initialValue: T): {|current: T|} {
      currentHookNameInDev = 'useRef';
      updateHookTypesDev();
      return mountRef(initialValue);
    },
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      updateHookTypesDev();
      return mountDebugValue(value, formatterFn);
    },
    useDeferredValue<T>(value: T): T {
      currentHookNameInDev = 'useDeferredValue';
      updateHookTypesDev();
      return mountDeferredValue(value);
    },
    useTransition(): [(() => void) => void, boolean] {
      currentHookNameInDev = 'useTransition';
      updateHookTypesDev();
      return mountTransition();
    },
    useMutableSource<Source, Snapshot>(
      source: MutableSource<Source>,
      getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
      subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
    ): Snapshot {
      currentHookNameInDev = 'useMutableSource';
      updateHookTypesDev();
      return mountMutableSource(source, getSnapshot, subscribe);
    },
    useOpaqueIdentifier(): OpaqueIDType | void {
      currentHookNameInDev = 'useOpaqueIdentifier';
      updateHookTypesDev();
      return mountOpaqueIdentifier();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };

  HooksDispatcherOnUpdateInDEV = {
    readContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      return readContext(context, observedBits);
    },
    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      updateHookTypesDev();
      return updateCallback(callback, deps);
    },
    useContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      currentHookNameInDev = 'useContext';
      updateHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      updateHookTypesDev();
      return updateEffect(create, deps);
    },
    useImperativeHandle<T>(
      ref: {|current: T | null|} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      updateHookTypesDev();
      return updateImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      updateHookTypesDev();
      return updateLayoutEffect(create, deps);
    },
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef<T>(initialValue: T): {|current: T|} {
      currentHookNameInDev = 'useRef';
      updateHookTypesDev();
      return updateRef(initialValue);
    },
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      updateHookTypesDev();
      return updateDebugValue(value, formatterFn);
    },
    useDeferredValue<T>(value: T): T {
      currentHookNameInDev = 'useDeferredValue';
      updateHookTypesDev();
      return updateDeferredValue(value);
    },
    useTransition(): [(() => void) => void, boolean] {
      currentHookNameInDev = 'useTransition';
      updateHookTypesDev();
      return updateTransition();
    },
    useMutableSource<Source, Snapshot>(
      source: MutableSource<Source>,
      getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
      subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
    ): Snapshot {
      currentHookNameInDev = 'useMutableSource';
      updateHookTypesDev();
      return updateMutableSource(source, getSnapshot, subscribe);
    },
    useOpaqueIdentifier(): OpaqueIDType | void {
      currentHookNameInDev = 'useOpaqueIdentifier';
      updateHookTypesDev();
      return updateOpaqueIdentifier();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };

  HooksDispatcherOnRerenderInDEV = {
    readContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      return readContext(context, observedBits);
    },

    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      updateHookTypesDev();
      return updateCallback(callback, deps);
    },
    useContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      currentHookNameInDev = 'useContext';
      updateHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      updateHookTypesDev();
      return updateEffect(create, deps);
    },
    useImperativeHandle<T>(
      ref: {|current: T | null|} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      updateHookTypesDev();
      return updateImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      updateHookTypesDev();
      return updateLayoutEffect(create, deps);
    },
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnRerenderInDEV;
      try {
        return updateMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnRerenderInDEV;
      try {
        return rerenderReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef<T>(initialValue: T): {|current: T|} {
      currentHookNameInDev = 'useRef';
      updateHookTypesDev();
      return updateRef(initialValue);
    },
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnRerenderInDEV;
      try {
        return rerenderState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      updateHookTypesDev();
      return updateDebugValue(value, formatterFn);
    },
    useDeferredValue<T>(value: T): T {
      currentHookNameInDev = 'useDeferredValue';
      updateHookTypesDev();
      return rerenderDeferredValue(value);
    },
    useTransition(): [(() => void) => void, boolean] {
      currentHookNameInDev = 'useTransition';
      updateHookTypesDev();
      return rerenderTransition();
    },
    useMutableSource<Source, Snapshot>(
      source: MutableSource<Source>,
      getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
      subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
    ): Snapshot {
      currentHookNameInDev = 'useMutableSource';
      updateHookTypesDev();
      return updateMutableSource(source, getSnapshot, subscribe);
    },
    useOpaqueIdentifier(): OpaqueIDType | void {
      currentHookNameInDev = 'useOpaqueIdentifier';
      updateHookTypesDev();
      return rerenderOpaqueIdentifier();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };

  InvalidNestedHooksDispatcherOnMountInDEV = {
    readContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      warnInvalidContextAccess();
      return readContext(context, observedBits);
    },
    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountCallback(callback, deps);
    },
    useContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      currentHookNameInDev = 'useContext';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountEffect(create, deps);
    },
    useImperativeHandle<T>(
      ref: {|current: T | null|} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountLayoutEffect(create, deps);
    },
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      warnInvalidHookAccess();
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      warnInvalidHookAccess();
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef<T>(initialValue: T): {|current: T|} {
      currentHookNameInDev = 'useRef';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountRef(initialValue);
    },
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      warnInvalidHookAccess();
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountDebugValue(value, formatterFn);
    },
    useDeferredValue<T>(value: T): T {
      currentHookNameInDev = 'useDeferredValue';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountDeferredValue(value);
    },
    useTransition(): [(() => void) => void, boolean] {
      currentHookNameInDev = 'useTransition';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountTransition();
    },
    useMutableSource<Source, Snapshot>(
      source: MutableSource<Source>,
      getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
      subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
    ): Snapshot {
      currentHookNameInDev = 'useMutableSource';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountMutableSource(source, getSnapshot, subscribe);
    },
    useOpaqueIdentifier(): OpaqueIDType | void {
      currentHookNameInDev = 'useOpaqueIdentifier';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountOpaqueIdentifier();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };

  InvalidNestedHooksDispatcherOnUpdateInDEV = {
    readContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      warnInvalidContextAccess();
      return readContext(context, observedBits);
    },
    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateCallback(callback, deps);
    },
    useContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      currentHookNameInDev = 'useContext';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateEffect(create, deps);
    },
    useImperativeHandle<T>(
      ref: {|current: T | null|} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateLayoutEffect(create, deps);
    },
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef<T>(initialValue: T): {|current: T|} {
      currentHookNameInDev = 'useRef';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateRef(initialValue);
    },
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateDebugValue(value, formatterFn);
    },
    useDeferredValue<T>(value: T): T {
      currentHookNameInDev = 'useDeferredValue';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateDeferredValue(value);
    },
    useTransition(): [(() => void) => void, boolean] {
      currentHookNameInDev = 'useTransition';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateTransition();
    },
    useMutableSource<Source, Snapshot>(
      source: MutableSource<Source>,
      getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
      subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
    ): Snapshot {
      currentHookNameInDev = 'useMutableSource';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateMutableSource(source, getSnapshot, subscribe);
    },
    useOpaqueIdentifier(): OpaqueIDType | void {
      currentHookNameInDev = 'useOpaqueIdentifier';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateOpaqueIdentifier();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };

  InvalidNestedHooksDispatcherOnRerenderInDEV = {
    readContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      warnInvalidContextAccess();
      return readContext(context, observedBits);
    },

    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateCallback(callback, deps);
    },
    useContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      currentHookNameInDev = 'useContext';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateEffect(create, deps);
    },
    useImperativeHandle<T>(
      ref: {|current: T | null|} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateLayoutEffect(create, deps);
    },
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return rerenderReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef<T>(initialValue: T): {|current: T|} {
      currentHookNameInDev = 'useRef';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateRef(initialValue);
    },
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return rerenderState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateDebugValue(value, formatterFn);
    },
    useDeferredValue<T>(value: T): T {
      currentHookNameInDev = 'useDeferredValue';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return rerenderDeferredValue(value);
    },
    useTransition(): [(() => void) => void, boolean] {
      currentHookNameInDev = 'useTransition';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return rerenderTransition();
    },
    useMutableSource<Source, Snapshot>(
      source: MutableSource<Source>,
      getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
      subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
    ): Snapshot {
      currentHookNameInDev = 'useMutableSource';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateMutableSource(source, getSnapshot, subscribe);
    },
    useOpaqueIdentifier(): OpaqueIDType | void {
      currentHookNameInDev = 'useOpaqueIdentifier';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return rerenderOpaqueIdentifier();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };
}
