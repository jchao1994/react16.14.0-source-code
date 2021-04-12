/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactProviderType, ReactContext} from 'shared/ReactTypes';
import type {BlockComponent} from 'react/src/ReactBlock';
import type {LazyComponent as LazyComponentType} from 'react/src/ReactLazy';
import type {Fiber} from './ReactInternalTypes';
import type {FiberRoot} from './ReactInternalTypes';
import type {Lanes, Lane} from './ReactFiberLane';
import type {MutableSource} from 'shared/ReactTypes';
import type {
  SuspenseState,
  SuspenseListRenderState,
  SuspenseListTailMode,
} from './ReactFiberSuspenseComponent.old';
import type {SuspenseContext} from './ReactFiberSuspenseContext.old';
import type {
  OffscreenProps,
  OffscreenState,
} from './ReactFiberOffscreenComponent';

import checkPropTypes from 'shared/checkPropTypes';

import {
  IndeterminateComponent,
  FunctionComponent,
  ClassComponent,
  HostRoot,
  HostComponent,
  HostText,
  HostPortal,
  ForwardRef,
  Fragment,
  Mode,
  ContextProvider,
  ContextConsumer,
  Profiler,
  SuspenseComponent,
  SuspenseListComponent,
  MemoComponent,
  SimpleMemoComponent,
  LazyComponent,
  IncompleteClassComponent,
  FundamentalComponent,
  ScopeComponent,
  Block,
  OffscreenComponent,
  LegacyHiddenComponent,
} from './ReactWorkTags';
import {
  NoFlags,
  PerformedWork,
  Placement,
  Hydrating,
  ContentReset,
  DidCapture,
  Update,
  Ref,
  Deletion,
  ForceUpdateForLegacySuspense,
} from './ReactFiberFlags';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import {
  debugRenderPhaseSideEffectsForStrictMode,
  disableLegacyContext,
  disableModulePatternComponents,
  enableProfilerTimer,
  enableSchedulerTracing,
  enableSuspenseServerRenderer,
  enableFundamentalAPI,
  warnAboutDefaultPropsOnFunctionComponents,
  enableScopeAPI,
  enableBlocksAPI,
} from 'shared/ReactFeatureFlags';
import invariant from 'shared/invariant';
import shallowEqual from 'shared/shallowEqual';
import getComponentName from 'shared/getComponentName';
import ReactStrictModeWarnings from './ReactStrictModeWarnings.old';
import {REACT_LAZY_TYPE, getIteratorFn} from 'shared/ReactSymbols';
import {
  getCurrentFiberOwnerNameInDevOrNull,
  setIsRendering,
} from './ReactCurrentFiber';
import {
  resolveFunctionForHotReloading,
  resolveForwardRefForHotReloading,
  resolveClassForHotReloading,
} from './ReactFiberHotReloading.old';

import {
  mountChildFibers,
  reconcileChildFibers,
  cloneChildFibers,
} from './ReactChildFiber.old';
import {
  processUpdateQueue,
  cloneUpdateQueue,
  initializeUpdateQueue,
} from './ReactUpdateQueue.old';
import {
  NoLane,
  NoLanes,
  SyncLane,
  OffscreenLane,
  DefaultHydrationLane,
  SomeRetryLane,
  NoTimestamp,
  includesSomeLane,
  laneToLanes,
  removeLanes,
  mergeLanes,
  getBumpedLaneForHydration,
} from './ReactFiberLane';
import {
  ConcurrentMode,
  NoMode,
  ProfileMode,
  StrictMode,
  BlockingMode,
} from './ReactTypeOfMode';
import {
  shouldSetTextContent,
  isSuspenseInstancePending,
  isSuspenseInstanceFallback,
  registerSuspenseInstanceRetry,
  supportsHydration,
} from './ReactFiberHostConfig';
import type {SuspenseInstance} from './ReactFiberHostConfig';
import {shouldSuspend} from './ReactFiberReconciler';
import {pushHostContext, pushHostContainer} from './ReactFiberHostContext.old';
import {
  suspenseStackCursor,
  pushSuspenseContext,
  InvisibleParentSuspenseContext,
  ForceSuspenseFallback,
  hasSuspenseContext,
  setDefaultShallowSuspenseContext,
  addSubtreeSuspenseContext,
  setShallowSuspenseContext,
} from './ReactFiberSuspenseContext.old';
import {findFirstSuspended} from './ReactFiberSuspenseComponent.old';
import {
  pushProvider,
  propagateContextChange,
  readContext,
  prepareToReadContext,
  calculateChangedBits,
  scheduleWorkOnParentPath,
} from './ReactFiberNewContext.old';
import {renderWithHooks, bailoutHooks} from './ReactFiberHooks.old';
import {stopProfilerTimerIfRunning} from './ReactProfilerTimer.old';
import {
  getMaskedContext,
  getUnmaskedContext,
  hasContextChanged as hasLegacyContextChanged,
  pushContextProvider as pushLegacyContextProvider,
  isContextProvider as isLegacyContextProvider,
  pushTopLevelContextObject,
  invalidateContextProvider,
} from './ReactFiberContext.old';
import {
  enterHydrationState,
  reenterHydrationStateFromDehydratedSuspenseInstance,
  resetHydrationState,
  tryToClaimNextHydratableInstance,
  warnIfHydrating,
} from './ReactFiberHydrationContext.old';
import {
  adoptClassInstance,
  applyDerivedStateFromProps,
  constructClassInstance,
  mountClassInstance,
  resumeMountClassInstance,
  updateClassInstance,
} from './ReactFiberClassComponent.old';
import {resolveDefaultProps} from './ReactFiberLazyComponent.old';
import {
  resolveLazyComponentTag,
  createFiberFromTypeAndProps,
  createFiberFromFragment,
  createFiberFromOffscreen,
  createWorkInProgress,
  isSimpleFunctionComponent,
} from './ReactFiber.old';
import {
  markSpawnedWork,
  retryDehydratedSuspenseBoundary,
  scheduleUpdateOnFiber,
  renderDidSuspendDelayIfPossible,
  markSkippedUpdateLanes,
  getWorkInProgressRoot,
  pushRenderLanes,
  getExecutionContext,
  RetryAfterError,
  NoContext,
} from './ReactFiberWorkLoop.old';
import {unstable_wrap as Schedule_tracing_wrap} from 'scheduler/tracing';
import {setWorkInProgressVersion} from './ReactMutableSource.old';

import {disableLogs, reenableLogs} from 'shared/ConsolePatchingDev';

const ReactCurrentOwner = ReactSharedInternals.ReactCurrentOwner;

let didReceiveUpdate: boolean = false;

let didWarnAboutBadClass;
let didWarnAboutModulePatternComponent;
let didWarnAboutContextTypeOnFunctionComponent;
let didWarnAboutGetDerivedStateOnFunctionComponent;
let didWarnAboutFunctionRefs;
export let didWarnAboutReassigningProps;
let didWarnAboutRevealOrder;
let didWarnAboutTailOptions;
let didWarnAboutDefaultPropsOnFunctionComponent;

if (__DEV__) {
  didWarnAboutBadClass = {};
  didWarnAboutModulePatternComponent = {};
  didWarnAboutContextTypeOnFunctionComponent = {};
  didWarnAboutGetDerivedStateOnFunctionComponent = {};
  didWarnAboutFunctionRefs = {};
  didWarnAboutReassigningProps = false;
  didWarnAboutRevealOrder = {};
  didWarnAboutTailOptions = {};
  didWarnAboutDefaultPropsOnFunctionComponent = {};
}

// 协调children，这里会做dom diff
// 获取第一个子workInProgress(复用或者新创建)放到workInProgress的child上
// 如果子workInProgress是新创建的，则没有对应currentFiber child sibling
// 如果子workInProgress是复用的，则没有对应sibling
export function reconcileChildren(
  current: Fiber | null, // currentFiber
  workInProgress: Fiber, // workInProgress
  nextChildren: any, // workInProgress.pendingProps.children/nextChildren
  renderLanes: Lanes,
) {
  if (current === null) {
    // If this is a fresh new component that hasn't been rendered yet, we
    // won't update its child set by applying minimal side-effects. Instead,
    // we will add them all to the child before it gets rendered. That means
    // we can optimize this reconciliation pass by not tracking side-effects.
    // 替换，currentFiber为null
    // mountChildFibers = ChildReconciler(false)，也就是reconcileChildFibers函数
    // 生成workInProgress的第一个子workInProgress
    // 这里会对newChild(如果是数组)中的每一项生成(新创建或复用)newFiber，并设置每一个newFiber的child sibling return
    workInProgress.child = mountChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderLanes,
    );
  } else {
    // If the current child is the same as the work in progress, it means that
    // we haven't yet started any work on these children. Therefore, we use
    // the clone algorithm to create a copy of all the current children.

    // If we had any progressed work already, that is invalid at this point so
    // let's throw it out.
    // 更新，currentFiber复用原来的
    // reconcileChildFibers = ChildReconciler(true)，也就是reconcileChildFibers函数
    // 生成workInProgress的第一个子workInProgress
    // 这里会对newChild(如果是数组)中的每一项生成(新创建或复用)newFiber，并设置每一个newFiber的child sibling return
    workInProgress.child = reconcileChildFibers(
      workInProgress,
      current.child,
      nextChildren,
      renderLanes,
    );
  }
}

// 卸载原有children，协调新的children，更新workInProgress.child用于下一个单元任务
function forceUnmountCurrentAndReconcile(
  current: Fiber,
  workInProgress: Fiber,
  nextChildren: any,
  renderLanes: Lanes,
) {
  // This function is fork of reconcileChildren. It's used in cases where we
  // want to reconcile without matching against the existing set. This has the
  // effect of all current children being unmounted; even if the type and key
  // are the same, the old child is unmounted and a new child is created.
  //
  // To do this, we're going to go through the reconcile algorithm twice. In
  // the first pass, we schedule a deletion for all the current children by
  // passing null.
  // 卸载原有children
  workInProgress.child = reconcileChildFibers(
    workInProgress,
    current.child,
    null,
    renderLanes,
  );
  // In the second pass, we mount the new children. The trick here is that we
  // pass null in place of where we usually pass the current child set. This has
  // the effect of remounting all children regardless of whether their
  // identities match.
  // 协调新的children
  workInProgress.child = reconcileChildFibers(
    workInProgress,
    null,
    nextChildren,
    renderLanes,
  );
}

function updateForwardRef(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
) {
  // TODO: current can be non-null here even if the component
  // hasn't yet mounted. This happens after the first render suspends.
  // We'll need to figure out if this is fine or can cause issues.

  if (__DEV__) {
    if (workInProgress.type !== workInProgress.elementType) {
      // Lazy component props can't be validated in createElement
      // because they're only guaranteed to be resolved here.
      const innerPropTypes = Component.propTypes;
      if (innerPropTypes) {
        checkPropTypes(
          innerPropTypes,
          nextProps, // Resolved props
          'prop',
          getComponentName(Component),
        );
      }
    }
  }

  const render = Component.render;
  const ref = workInProgress.ref;

  // The rest is a fork of updateFunctionComponent
  let nextChildren;
  prepareToReadContext(workInProgress, renderLanes);
  if (__DEV__) {
    ReactCurrentOwner.current = workInProgress;
    setIsRendering(true);
    nextChildren = renderWithHooks(
      current,
      workInProgress,
      render,
      nextProps,
      ref,
      renderLanes,
    );
    if (
      debugRenderPhaseSideEffectsForStrictMode &&
      workInProgress.mode & StrictMode
    ) {
      disableLogs();
      try {
        nextChildren = renderWithHooks(
          current,
          workInProgress,
          render,
          nextProps,
          ref,
          renderLanes,
        );
      } finally {
        reenableLogs();
      }
    }
    setIsRendering(false);
  } else {
    nextChildren = renderWithHooks(
      current,
      workInProgress,
      render,
      nextProps,
      ref,
      renderLanes,
    );
  }

  if (current !== null && !didReceiveUpdate) {
    bailoutHooks(current, workInProgress, renderLanes);
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }

  // React DevTools reads this flag.
  workInProgress.flags |= PerformedWork;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

// React.memo(Component)
// 只有当传入的compare比较新老props和新老ref相同，且源Component对应的workInProgress没有更新，才会返回null，
// 也就是源Component对应的workInProgress不执行performUnitOfWork => renderWithHooks
function updateMemoComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any, // 源Component的构造函数
  nextProps: any, // 处理完毕的新props
  updateLanes: Lanes,
  renderLanes: Lanes,
): null | Fiber {
  if (current === null) {
    // 没有current，首次渲染
    const type = Component.type;
    if (
      isSimpleFunctionComponent(type) &&
      Component.compare === null &&
      // SimpleMemoComponent codepath doesn't resolve outer props either.
      Component.defaultProps === undefined
    ) {
      let resolvedType = type;
      if (__DEV__) {
        resolvedType = resolveFunctionForHotReloading(type);
      }
      // If this is a plain function component without default props,
      // and with only the default shallow comparison, we upgrade it
      // to a SimpleMemoComponent to allow fast path updates.
      workInProgress.tag = SimpleMemoComponent;
      workInProgress.type = resolvedType;
      if (__DEV__) {
        validateFunctionComponentInDev(workInProgress, type);
      }
      return updateSimpleMemoComponent(
        current,
        workInProgress,
        resolvedType,
        nextProps,
        updateLanes,
        renderLanes,
      );
    }
    if (__DEV__) {
      const innerPropTypes = type.propTypes;
      if (innerPropTypes) {
        // Inner memo component props aren't currently validated in createElement.
        // We could move it there, but we'd still need this for lazy code path.
        checkPropTypes(
          innerPropTypes,
          nextProps, // Resolved props
          'prop',
          getComponentName(type),
        );
      }
    }
    // 创建源Component的fiber，作为React.memo(Component)的child fiber
    const child = createFiberFromTypeAndProps(
      Component.type,
      null,
      nextProps,
      workInProgress,
      workInProgress.mode,
      renderLanes,
    );
    child.ref = workInProgress.ref;
    child.return = workInProgress;
    workInProgress.child = child;
    return child;
  }

  // 下面的逻辑是存在current，也就是可复用的情况

  if (__DEV__) {
    const type = Component.type;
    const innerPropTypes = type.propTypes;
    if (innerPropTypes) {
      // Inner memo component props aren't currently validated in createElement.
      // We could move it there, but we'd still need this for lazy code path.
      checkPropTypes(
        innerPropTypes,
        nextProps, // Resolved props
        'prop',
        getComponentName(type),
      );
    }
  }
  // React.memo只可能有一个child
  const currentChild = ((current.child: any): Fiber); // This is always exactly one child
  if (!includesSomeLane(updateLanes, renderLanes)) {
    // This will be the props with resolved defaultProps,
    // unlike current.memoizedProps which will be the unresolved ones.
    const prevProps = currentChild.memoizedProps;
    // Default to shallow comparison
    let compare = Component.compare;
    // 默认采用shallowEqual
    compare = compare !== null ? compare : shallowEqual;
    // 新老props和ref都相同，查看children是否需要更新
    // compare比较是在React.memo(Component)这一层fiber上的
    // 如果在这里return出去且children(也就是实际源Component对应的workInProgress)没有更新，那么实际源Component对应的workInProgress不会执行performUnitOfWork => renderWithHooks
    // 如果children(也就是实际源Component对应的workInProgress)发生了更新，这里依旧会返回children的拷贝fiber，进行performUnitOfWork => renderWithHooks
    if (compare(prevProps, nextProps) && current.ref === workInProgress.ref) {
      return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
    }
  }
  // React DevTools reads this flag.
  workInProgress.flags |= PerformedWork;
  const newChild = createWorkInProgress(currentChild, nextProps);
  newChild.ref = workInProgress.ref;
  newChild.return = workInProgress;
  workInProgress.child = newChild;
  // 返回的newChild才是实际源Component对应的workInProgress
  // 然后这个workInProgress就会执行performUnitOfWork => renderWithHooks
  return newChild;
}

function updateSimpleMemoComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  updateLanes: Lanes,
  renderLanes: Lanes,
): null | Fiber {
  // TODO: current can be non-null here even if the component
  // hasn't yet mounted. This happens when the inner render suspends.
  // We'll need to figure out if this is fine or can cause issues.

  if (__DEV__) {
    if (workInProgress.type !== workInProgress.elementType) {
      // Lazy component props can't be validated in createElement
      // because they're only guaranteed to be resolved here.
      let outerMemoType = workInProgress.elementType;
      if (outerMemoType.$$typeof === REACT_LAZY_TYPE) {
        // We warn when you define propTypes on lazy()
        // so let's just skip over it to find memo() outer wrapper.
        // Inner props for memo are validated later.
        const lazyComponent: LazyComponentType<any, any> = outerMemoType;
        const payload = lazyComponent._payload;
        const init = lazyComponent._init;
        try {
          outerMemoType = init(payload);
        } catch (x) {
          outerMemoType = null;
        }
        // Inner propTypes will be validated in the function component path.
        const outerPropTypes = outerMemoType && (outerMemoType: any).propTypes;
        if (outerPropTypes) {
          checkPropTypes(
            outerPropTypes,
            nextProps, // Resolved (SimpleMemoComponent has no defaultProps)
            'prop',
            getComponentName(outerMemoType),
          );
        }
      }
    }
  }
  if (current !== null) {
    const prevProps = current.memoizedProps;
    if (
      shallowEqual(prevProps, nextProps) &&
      current.ref === workInProgress.ref &&
      // Prevent bailout if the implementation changed due to hot reload.
      (__DEV__ ? workInProgress.type === current.type : true)
    ) {
      didReceiveUpdate = false;
      if (!includesSomeLane(renderLanes, updateLanes)) {
        // The pending lanes were cleared at the beginning of beginWork. We're
        // about to bail out, but there might be other lanes that weren't
        // included in the current render. Usually, the priority level of the
        // remaining updates is accumlated during the evaluation of the
        // component (i.e. when processing the update queue). But since since
        // we're bailing out early *without* evaluating the component, we need
        // to account for it here, too. Reset to the value of the current fiber.
        // NOTE: This only applies to SimpleMemoComponent, not MemoComponent,
        // because a MemoComponent fiber does not have hooks or an update queue;
        // rather, it wraps around an inner component, which may or may not
        // contains hooks.
        // TODO: Move the reset at in beginWork out of the common path so that
        // this is no longer necessary.
        workInProgress.lanes = current.lanes;
        return bailoutOnAlreadyFinishedWork(
          current,
          workInProgress,
          renderLanes,
        );
      } else if ((current.flags & ForceUpdateForLegacySuspense) !== NoFlags) {
        // This is a special case that only exists for legacy mode.
        // See https://github.com/facebook/react/pull/19216.
        didReceiveUpdate = true;
      }
    }
  }
  return updateFunctionComponent(
    current,
    workInProgress,
    Component,
    nextProps,
    renderLanes,
  );
}

// offscreen隐藏组件
function updateOffscreenComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const nextProps: OffscreenProps = workInProgress.pendingProps;
  const nextChildren = nextProps.children;

  const prevState: OffscreenState | null =
    current !== null ? current.memoizedState : null;

  if (
    nextProps.mode === 'hidden' ||
    nextProps.mode === 'unstable-defer-without-hiding'
  ) {
    if ((workInProgress.mode & ConcurrentMode) === NoMode) {
      // In legacy sync mode, don't defer the subtree. Render it now.
      // TODO: Figure out what we should do in Blocking mode.
      const nextState: OffscreenState = {
        baseLanes: NoLanes,
      };
      workInProgress.memoizedState = nextState;
      pushRenderLanes(workInProgress, renderLanes);
    } else if (!includesSomeLane(renderLanes, (OffscreenLane: Lane))) {
      let nextBaseLanes;
      if (prevState !== null) {
        const prevBaseLanes = prevState.baseLanes;
        nextBaseLanes = mergeLanes(prevBaseLanes, renderLanes);
      } else {
        nextBaseLanes = renderLanes;
      }

      // Schedule this fiber to re-render at offscreen priority. Then bailout.
      if (enableSchedulerTracing) {
        markSpawnedWork((OffscreenLane: Lane));
      }
      workInProgress.lanes = workInProgress.childLanes = laneToLanes(
        OffscreenLane,
      );
      const nextState: OffscreenState = {
        baseLanes: nextBaseLanes,
      };
      workInProgress.memoizedState = nextState;
      // We're about to bail out, but we need to push this to the stack anyway
      // to avoid a push/pop misalignment.
      pushRenderLanes(workInProgress, nextBaseLanes);
      return null;
    } else {
      // Rendering at offscreen, so we can clear the base lanes.
      const nextState: OffscreenState = {
        baseLanes: NoLanes,
      };
      workInProgress.memoizedState = nextState;
      // Push the lanes that were skipped when we bailed out.
      const subtreeRenderLanes =
        prevState !== null ? prevState.baseLanes : renderLanes;
      pushRenderLanes(workInProgress, subtreeRenderLanes);
    }
  } else {
    let subtreeRenderLanes;
    if (prevState !== null) {
      subtreeRenderLanes = mergeLanes(prevState.baseLanes, renderLanes);
      // Since we're not hidden anymore, reset the state
      workInProgress.memoizedState = null;
    } else {
      // We weren't previously hidden, and we still aren't, so there's nothing
      // special to do. Need to push to the stack regardless, though, to avoid
      // a push/pop misalignment.
      subtreeRenderLanes = renderLanes;
    }
    pushRenderLanes(workInProgress, subtreeRenderLanes);
  }

  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

// Note: These happen to have identical begin phases, for now. We shouldn't hold
// ourselves to this constraint, though. If the behavior diverges, we should
// fork the function.
const updateLegacyHiddenComponent = updateOffscreenComponent;

function updateFragment(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const nextChildren = workInProgress.pendingProps;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

function updateMode(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const nextChildren = workInProgress.pendingProps.children;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

function updateProfiler(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  if (enableProfilerTimer) {
    workInProgress.flags |= Update;

    // Reset effect durations for the next eventual effect phase.
    // These are reset during render to allow the DevTools commit hook a chance to read them,
    const stateNode = workInProgress.stateNode;
    stateNode.effectDuration = 0;
    stateNode.passiveEffectDuration = 0;
  }
  const nextProps = workInProgress.pendingProps;
  const nextChildren = nextProps.children;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

// ref发生了变化，为workInProgress.ref加上ref副作用
function markRef(current: Fiber | null, workInProgress: Fiber) {
  const ref = workInProgress.ref;
  if (
    (current === null && ref !== null) ||
    (current !== null && current.ref !== ref)
  ) {
    // Schedule a Ref effect
    workInProgress.flags |= Ref;
  }
}

// 函数组件
function updateFunctionComponent(
  current,
  workInProgress,
  Component, // workInProgress.type 函数组件的构造函数
  nextProps: any, // 处理过的新props
  renderLanes,
) {
  if (__DEV__) {
    if (workInProgress.type !== workInProgress.elementType) {
      // Lazy component props can't be validated in createElement
      // because they're only guaranteed to be resolved here.
      const innerPropTypes = Component.propTypes;
      if (innerPropTypes) {
        checkPropTypes(
          innerPropTypes,
          nextProps, // Resolved props
          'prop',
          getComponentName(Component),
        );
      }
    }
  }

  let context;
  // 获取context
  if (!disableLegacyContext) {
    const unmaskedContext = getUnmaskedContext(workInProgress, Component, true);
    context = getMaskedContext(workInProgress, unmaskedContext);
  }

  let nextChildren;
  // 设置didReceiveUpdate，标记当前workInProgress是否需要接收更新
  prepareToReadContext(workInProgress, renderLanes);
  if (__DEV__) {
    ReactCurrentOwner.current = workInProgress;
    setIsRendering(true);
    nextChildren = renderWithHooks(
      current,
      workInProgress,
      Component,
      nextProps,
      context,
      renderLanes,
    );
    if (
      debugRenderPhaseSideEffectsForStrictMode &&
      workInProgress.mode & StrictMode
    ) {
      disableLogs();
      try {
        nextChildren = renderWithHooks(
          current,
          workInProgress,
          Component,
          nextProps,
          context,
          renderLanes,
        );
      } finally {
        reenableLogs();
      }
    }
    setIsRendering(false);
  } else {
    // 根据hooks执行构造函数生成nextChildren
    // 在Component(props, secondArg)生成children的过程中，会执行构造函数中的hooks相关方法
    nextChildren = renderWithHooks(
      current,
      workInProgress,
      Component,
      nextProps,
      context,
      renderLanes,
    );
  }

  // 下面的逻辑与类组件类似
  // 不同的是，没有另外的shouldUpdate标志是否应该更新，而是通过didReceiveUpdate，新老state不同，就会标记didReceiveUpdate为true
  // 而且函数组件通过renderWithHooks来生成nextChildren(在到达这里之前已经生成)，类组件通过组件实例的render函数生成nextChildren(在这里之后才执行render生成)

  // 不需要更新，也就是新老state相同
  // didReceiveUpdate为true，就一定会走reconcileChildren逻辑render
  if (current !== null && !didReceiveUpdate) {
    // workInProgress复用current.updateQueue
    // workInProgress清除passiveEffect和updateEffect副作用
    // current的lanes移除renderLanes
    bailoutHooks(current, workInProgress, renderLanes);
    // workInProgress的children也没有更新工作，就返回null
    // workInProgress的children有更新工作，就clone出新的children并返回workInProgress.child作为下一个单元工作
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }

  // 走到这里，说明新老state不同，也就是didReceiveUpdate为true，需要更新

  // React DevTools reads this flag.
  // 添加PerformedWork副作用，给React DevTools读取
  workInProgress.flags |= PerformedWork;
  // 协调children，这里会做dom diff
  // 获取第一个子workInProgress(复用或者新创建)放到workInProgress的child上
  // 如果子workInProgress是新创建的，则没有对应currentFiber child sibling
  // 如果子workInProgress是复用的，则没有对应sibling
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

function updateBlock<Props, Data>(
  current: Fiber | null,
  workInProgress: Fiber,
  block: BlockComponent<Props, Data>,
  nextProps: any,
  renderLanes: Lanes,
) {
  // TODO: current can be non-null here even if the component
  // hasn't yet mounted. This happens after the first render suspends.
  // We'll need to figure out if this is fine or can cause issues.

  const render = block._render;
  const data = block._data;

  // The rest is a fork of updateFunctionComponent
  let nextChildren;
  prepareToReadContext(workInProgress, renderLanes);
  if (__DEV__) {
    ReactCurrentOwner.current = workInProgress;
    setIsRendering(true);
    nextChildren = renderWithHooks(
      current,
      workInProgress,
      render,
      nextProps,
      data,
      renderLanes,
    );
    if (
      debugRenderPhaseSideEffectsForStrictMode &&
      workInProgress.mode & StrictMode
    ) {
      disableLogs();
      try {
        nextChildren = renderWithHooks(
          current,
          workInProgress,
          render,
          nextProps,
          data,
          renderLanes,
        );
      } finally {
        reenableLogs();
      }
    }
    setIsRendering(false);
  } else {
    nextChildren = renderWithHooks(
      current,
      workInProgress,
      render,
      nextProps,
      data,
      renderLanes,
    );
  }

  if (current !== null && !didReceiveUpdate) {
    bailoutHooks(current, workInProgress, renderLanes);
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }

  // React DevTools reads this flag.
  workInProgress.flags |= PerformedWork;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

// 先进行更新类组件前的工作(包括根据workInProgress.updateQueue.shared.pending生成newState，对比新老props和新老state)以及调用相关生命周期得到shouldUpdate
// 然后根据shouldUpdate进行协调children，做dom diff并返回workInProgress.child作为下一个单元任务
// 这里还会添加ref副作用(如果ref变化)
function updateClassComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any, // workInProgress.type 类组件的组件构造器
  nextProps: any, // 处理过的新props
  renderLanes: Lanes,
) {
  if (__DEV__) {
    if (workInProgress.type !== workInProgress.elementType) {
      // Lazy component props can't be validated in createElement
      // because they're only guaranteed to be resolved here.
      const innerPropTypes = Component.propTypes;
      if (innerPropTypes) {
        checkPropTypes(
          innerPropTypes,
          nextProps, // Resolved props
          'prop',
          getComponentName(Component),
        );
      }
    }
  }

  // Push context providers early to prevent context stack mismatches.
  // During mounting we don't know the child context yet as the instance doesn't exist.
  // We will invalidate the child context in finishClassComponent() right after rendering.
  let hasContext;
  // 更新hasContext 是否有上下文
  if (isLegacyContextProvider(Component)) {
    hasContext = true;
    // 更新context didPerformWork指针
    pushLegacyContextProvider(workInProgress);
  } else {
    hasContext = false;
  }
  // 设置didReceiveUpdate，标记当前workInProgress是否需要接收更新
  prepareToReadContext(workInProgress, renderLanes);

  // 组件实例
  const instance = workInProgress.stateNode;
  let shouldUpdate;
  // 做更新前的处理(包括根据workInProgress.updateQueue.shared.pending生成newState，对比新老props和新老state)，判断是否shouldUpdate
  // 调用更新前的生命周期，并为更新后需要调用的生命周期加上副作用
  // 这里包括处理workInProgress.updateQueue.shared.pending和workInProgress.updateQueue的baseUpdate链表，生成新state
  // workInProgress.memoizedState指向最新的state
  if (instance === null) {
    // workInProgress没有stateNode
    if (current !== null) {
      // A class component without an instance only mounts if it suspended
      // inside a non-concurrent tree, in an inconsistent state. We want to
      // treat it like a new mount, even though an empty version of it already
      // committed. Disconnect the alternate pointers.
      // 只有suspense才会出现复用且没有stateNode的情况，当作创建新的处理，设置Placement副作用
      // 移除current和workInProgress互相指引，把workInProgress当作一个新的处理
      current.alternate = null;
      workInProgress.alternate = null;
      // Since this is conceptually a new fiber, schedule a Placement effect
      // 给当前workInProgress添加Placement副作用，completeUnitOfWork时会将自身添加到父workInProgress的effect list链表的最后
      workInProgress.flags |= Placement;
    }
    // In the initial pass we might need to construct the instance.
    // 这是初始化过程(新创建)，既没有stateNode也没有currentFiber

    // 创建新的组件实例，更新workInProgress.memoizedState
    // 给组件实例挂上setState replaceState forceUpdate方法，然后和workInProgress互相指引
    constructClassInstance(workInProgress, Component, nextProps);
    // 核心逻辑是 processUpdateQueue
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
    // 执行完processUpdateQueue后，才进行如下逻辑
    // 对从未render过的组件实例调用getDerivedStateFromProps UNSAFE_componentWillMount componentWillMount生命周期，更新instance.state
    // UNSAFE_componentWillMount componentWillMount这两个过时的生命周期只有在不使用getDerivedStateFromProps和getSnapshotBeforeUpdate时候才会调用
    // componentDidMount这里不调用，只给workInProgress标记update副作用，在commit阶段会调用componentDidMount
    mountClassInstance(workInProgress, Component, nextProps, renderLanes);
    // 标记应该update
    shouldUpdate = true;
  } else if (current === null) {
    // In a resume, we'll already have an instance we can reuse.
    // 有组件实例复用，但是没有currentFiber

    // 复用组件实例
    // 调用getDerivedStateFromProps
    // 根据hasForceUpdate shouldComponentUpdate PureReactComponent设置shouldUpdate
    // shouldUpdate为true，就会调用componentWillMount和UNSAFE_componentWillMount生命周期
    // 为componentDidMount加上update副作用
    // 最后更新workInProgress的memoizedProps和memoizedState以及组件实例的props state context
    // 返回shouldUpdate
    // 这里不执行更新，只是做更新前的处理(包括根据workInProgress.updateQueue.shared.pending生成newState，对比新老props和新老state)，判断是否应该update
    shouldUpdate = resumeMountClassInstance(
      workInProgress,
      Component,
      nextProps,
      renderLanes,
    );
  } else {
    // 有组件实例复用，也有currentFiber

    // 复用组件实例，逻辑与resumeMountClassInstance类似
    // 调用getDerivedStateFromProps
    // 根据hasForceUpdate shouldComponentUpdate PureReactComponent设置shouldUpdate
    // shouldUpdate为true，就会调用componentWillUpdate和UNSAFE_componentWillUpdate生命周期
    // 为componentDidUpdate和getSnapshotBeforeUpdate加上update和snapshot副作用
    // 最后更新workInProgress的memoizedProps和memoizedState以及组件实例的props state context
    // 返回shouldUpdate
    // 这里不执行更新，只是做更新前的处理(包括根据workInProgress.updateQueue.shared.pending生成newState，对比新老props和新老state)，判断是否应该update
    shouldUpdate = updateClassInstance(
      current,
      workInProgress,
      Component,
      nextProps,
      renderLanes,
    );
  }
  // 到这里，已经完成更新前的工作(已经处理了workInProgress.updateQueue.shared.pending和workInProgress.updateQueue的baseUpdate链表，生成新state)
  // 下面就是核心逻辑，dom diff并返回下一个单元任务workInProgress.child

  // 如果应该update
  //    加上ref副作用，调用组件实例的render方法生成nextChildren
  //    然后reconcileChildren协调children，做dom diff并生成新的 workInProgress.child 作为下一个单元任务
  // 如果不应该update
  //    查找children，如需要更新，则克隆children返回workInProgress.child进行下一个单元任务
  // 如果有报错，就diff卸载当前正确逻辑的children，然后diff渲染错误逻辑的children，也就是降级渲染UI
  const nextUnitOfWork = finishClassComponent(
    current,
    workInProgress,
    Component,
    shouldUpdate,
    hasContext,
    renderLanes,
  );
  if (__DEV__) {
    const inst = workInProgress.stateNode;
    if (shouldUpdate && inst.props !== nextProps) {
      if (!didWarnAboutReassigningProps) {
        console.error(
          'It looks like %s is reassigning its own `this.props` while rendering. ' +
            'This is not supported and can lead to confusing bugs.',
          getComponentName(workInProgress.type) || 'a component',
        );
      }
      didWarnAboutReassigningProps = true;
    }
  }
  return nextUnitOfWork;
}

// 完成类组件更新前的工作之后(已经处理了workInProgress.updateQueue.shared.pending和workInProgress.updateQueue的baseUpdate链表，生成新state)，调用这个方法
// 如果应该update
//    加上ref副作用，调用组件实例的render方法生成nextChildren
//    然后reconcileChildren协调children，做dom diff并生成新的 workInProgress.child 作为下一个单元任务
// 如果不应该update
//    查找children，如需要更新，则克隆children返回workInProgress.child进行下一个单元任务
// 如果有报错，就diff卸载当前正确逻辑的children，然后diff渲染错误逻辑的children，也就是降级渲染UI
function finishClassComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any, // 类组件的组件构造器
  shouldUpdate: boolean, // 是否应该更新
  hasContext: boolean,
  renderLanes: Lanes,
) {
  // Refs should update even if shouldComponentUpdate returns false
  // ref发生了变化，为workInProgress.ref加上ref副作用
  markRef(current, workInProgress);

  // 有didCapture副作用
  const didCaptureError = (workInProgress.flags & DidCapture) !== NoFlags;

  // shouldUpdate为false，就接着下一个单元任务workInProgress.child
  if (!shouldUpdate && !didCaptureError) {
    // Context providers should defer to sCU for rendering
    if (hasContext) {
      // 更新didPerformWork指针指向false
      invalidateContextProvider(workInProgress, Component, false);
    }
    // workInProgress的children也没有更新工作，就返回null
    // workInProgress的children有更新工作，就clone出新的children并返回workInProgress.child作为下一个单元工作
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }

  // 更新完毕的组件实例
  const instance = workInProgress.stateNode;

  // Rerender
  // ReactCurrentOwner.current指针指向当前最新的workInProgress
  // ReactDOM.render(<App/>, document.getElementById('root')) 在这里就指向了<App/>对应的root workInProgress
  // 这就在ReactElement与fiber之间建立桥梁关系
  ReactCurrentOwner.current = workInProgress;
  // 执行组件实例的render方法，获取nextChildren
  let nextChildren;
  // 有didCapture副作用且没有getDerivedStateFromError，卸载所有children
  // 会调度一个update来执行componentDidCatch进行re-render
  // 一般用componentDidCatch渲染降级UI，也就是报错时展示的页面
  // 推荐用getDerivedStateFromError代替
  if (
    didCaptureError &&
    typeof Component.getDerivedStateFromError !== 'function'
  ) {
    // If we captured an error, but getDerivedStateFromError is not defined,
    // unmount all the children. componentDidCatch will schedule an update to
    // re-render a fallback. This is temporary until we migrate everyone to
    // the new API.
    // TODO: Warn in a future release.
    nextChildren = null;

    // 停止计算时间
    if (enableProfilerTimer) {
      stopProfilerTimerIfRunning(workInProgress);
    }
  } else {
    // 没有报错，执行render方法，获取nextChildren，用于之后的diff
    if (__DEV__) {
      setIsRendering(true);
      nextChildren = instance.render();
      if (
        debugRenderPhaseSideEffectsForStrictMode &&
        workInProgress.mode & StrictMode
      ) {
        disableLogs();
        try {
          instance.render();
        } finally {
          reenableLogs();
        }
      }
      setIsRendering(false);
    } else {
      // 执行当前组件实例的render方法，获取nextChildren(jsx转换而成的reactElement对象)
      nextChildren = instance.render();
    }
  }

  // React DevTools reads this flag.
  // 给workInProgress加上PerformedWork副作用，这个副作用是给React DevTools读取的
  // 如果workInProgress的flags只有PerformedWork，是不会在completeUnitOfWork时将自身添加到父workInProgress的effect list链表中的
  workInProgress.flags |= PerformedWork;
  if (current !== null && didCaptureError) {
    // If we're recovering from an error, reconcile without reusing any of
    // the existing children. Conceptually, the normal children and the children
    // that are shown on error are two different sets, so we shouldn't reuse
    // normal children even if their identities match.
    // 有老的currentFiber和报错，那协调过程不能重用存在的children
    // 因为正确的和错误的逻辑和渲染时分开的，当报错的时候，就应该走错误的逻辑，并使用错误的children来渲染
    
    // 卸载原有children，协调新的children，更新workInProgress.child用于下一个单元任务
    forceUnmountCurrentAndReconcile(
      current,
      workInProgress,
      nextChildren,
      renderLanes,
    );
  } else {
    // 一般流程走这里
    // 协调children，这里会做dom diff
    // 获取第一个子workInProgress(复用或者新创建)放到workInProgress的child上，用于下一个单元任务
    // 如果子workInProgress是新创建的，则没有对应currentFiber child sibling
    // 如果子workInProgress是复用的，则没有对应sibling
    reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  }

  // Memoize state using the values we just used to render.
  // TODO: Restructure so we never read values from the instance.
  // workInProgress的memoizedState指向组件实例的state，最新的
  workInProgress.memoizedState = instance.state;

  // The context might have changed so we need to recalculate it.
  if (hasContext) {
    // 更新didPerformWork指针指向true
    invalidateContextProvider(workInProgress, Component, true);
  }

  // 返回workInProgress.child作为下一个单元任务
  return workInProgress.child;
}

// 更新didPerformWork rootInstance contextFiber context context指针
function pushHostRootContext(workInProgress) {
  const root = (workInProgress.stateNode: FiberRoot);
  if (root.pendingContext) {
    // 更新context和didPerformWork指针
    pushTopLevelContextObject(
      workInProgress,
      root.pendingContext,
      root.pendingContext !== root.context, // didChange
    );
  } else if (root.context) {
    // Should always be set
    // 更新context和didPerformWork指针，这里didChange为false
    pushTopLevelContextObject(workInProgress, root.context, false);
  }
  // 更新rootInstance contextFiber context指针
  pushHostContainer(workInProgress, root.containerInfo);
}

function updateHostRoot(current, workInProgress, renderLanes) {
  // 更新didPerformWork rootInstance contextFiber context context指针
  pushHostRootContext(workInProgress);
  // updateQueue更新队列
  const updateQueue = workInProgress.updateQueue;
  invariant(
    current !== null && updateQueue !== null,
    'If the root does not have an updateQueue, we should have already ' +
      'bailed out. This error is likely caused by a bug in React. Please ' +
      'file an issue.',
  );
  const nextProps = workInProgress.pendingProps;
  const prevState = workInProgress.memoizedState;
  const prevChildren = prevState !== null ? prevState.element : null;
  // 将currentFiber的updateQueue克隆到workInProgress.updateQueue上
  // 这样两个updateQueue就不相同了，原来两个是相同的
  // 此时updateQueue指向老的，workInProgress.updateQueue指向新克隆的
  cloneUpdateQueue(current, workInProgress);
  // 更新workInProgress.updateQueue的baseState firstBaseUpdate lastBaseUpdate
  // 标记更新lanes跳过newLanes，更新workInProgress的lanes和memoizedState
  processUpdateQueue(workInProgress, nextProps, null, renderLanes);
  // nextState就是processUpdateQueue过程中更新的
  const nextState = workInProgress.memoizedState;
  // Caution: React DevTools currently depends on this property
  // being called "element".
  // React DevTools依赖这个nextState.element属性

  const nextChildren = nextState.element;
  if (nextChildren === prevChildren) {
    // 新老children相同，表明当前workInProgress没有更新工作
    // 接着判断children是否有更新工作，返回workInProgress.child或者null

    // 重置hydration状态
    resetHydrationState();
    // 查看workInProgress.children是否有更新工作，返回workInProgress.child或者null
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }

  // 这里的情况是新老children不同，接下来就是要协调children
  // root workInProgress对应的是fiberRoot
  const root: FiberRoot = workInProgress.stateNode;
  if (root.hydrate && enterHydrationState(workInProgress)) {
    // If we don't have any current children this might be the first pass.
    // We always try to hydrate. If this isn't a hydration pass there won't
    // be any children to hydrate which is effectively the same thing as
    // not hydrating.
    // SSR，暂时不看???

    if (supportsHydration) {
      const mutableSourceEagerHydrationData =
        root.mutableSourceEagerHydrationData;
      if (mutableSourceEagerHydrationData != null) {
        for (let i = 0; i < mutableSourceEagerHydrationData.length; i += 2) {
          const mutableSource = ((mutableSourceEagerHydrationData[
            i
          ]: any): MutableSource<any>);
          const version = mutableSourceEagerHydrationData[i + 1];
          setWorkInProgressVersion(mutableSource, version);
        }
      }
    }

    const child = mountChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderLanes,
    );
    workInProgress.child = child;

    let node = child;
    while (node) {
      // Mark each child as hydrating. This is a fast path to know whether this
      // tree is part of a hydrating tree. This is used to determine if a child
      // node has fully mounted yet, and for scheduling event replaying.
      // Conceptually this is similar to Placement in that a new subtree is
      // inserted into the React tree here. It just happens to not need DOM
      // mutations because it already exists.
      node.flags = (node.flags & ~Placement) | Hydrating;
      node = node.sibling;
    }
  } else {
    // Otherwise reset hydration state in case we aborted and resumed another
    // root.
    // 协调children，这里会做dom diff
    // 更新workInProgress.child(复用或新创建)，用作下一个单元任务
    // 如果是新创建，则没有对应currentFiber child sibling
    // 如果是复用，则没有对应sibling
    reconcileChildren(current, workInProgress, nextChildren, renderLanes);
    // 重置hyration状态
    resetHydrationState();
  }
  return workInProgress.child;
}

// dom diff生成workInProgress的最新的第一个子workInProgress
function updateHostComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  // 更新上下文fiber和上下文context的指针，原指针入栈
  pushHostContext(workInProgress);

  if (current === null) {
    tryToClaimNextHydratableInstance(workInProgress);
  }

  const type = workInProgress.type;
  const nextProps = workInProgress.pendingProps;
  const prevProps = current !== null ? current.memoizedProps : null;

  let nextChildren = nextProps.children;
  const isDirectTextChild = shouldSetTextContent(type, nextProps);

  if (isDirectTextChild) {
    // We special case a direct text child of a host node. This is a common
    // case. We won't handle it as a reified child. We will instead handle
    // this in the host environment that also has access to this prop. That
    // avoids allocating another HostText fiber and traversing it.
    nextChildren = null;
  } else if (prevProps !== null && shouldSetTextContent(type, prevProps)) {
    // If we're switching from a direct text child to a normal child, or to
    // empty, we need to schedule the text content to be reset.
    workInProgress.flags |= ContentReset;
  }

  // workInProgress标记ref
  markRef(current, workInProgress);
  // 协调children，复用或是新创建当前workInProgress的第一个子workInProgress
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  // 把reconcileChildren创建的第一个子workInProgress返回
  return workInProgress.child;
}

function updateHostText(current, workInProgress) {
  if (current === null) {
    tryToClaimNextHydratableInstance(workInProgress);
  }
  // Nothing to do here. This is terminal. We'll do the completion step
  // immediately after.
  return null;
}

function mountLazyComponent(
  _current,
  workInProgress,
  elementType,
  updateLanes,
  renderLanes,
) {
  if (_current !== null) {
    // A lazy component only mounts if it suspended inside a non-
    // concurrent tree, in an inconsistent state. We want to treat it like
    // a new mount, even though an empty version of it already committed.
    // Disconnect the alternate pointers.
    _current.alternate = null;
    workInProgress.alternate = null;
    // Since this is conceptually a new fiber, schedule a Placement effect
    workInProgress.flags |= Placement;
  }

  const props = workInProgress.pendingProps;
  const lazyComponent: LazyComponentType<any, any> = elementType;
  const payload = lazyComponent._payload;
  const init = lazyComponent._init;
  let Component = init(payload);
  // Store the unwrapped component in the type.
  workInProgress.type = Component;
  const resolvedTag = (workInProgress.tag = resolveLazyComponentTag(Component));
  const resolvedProps = resolveDefaultProps(Component, props);
  let child;
  switch (resolvedTag) {
    case FunctionComponent: {
      if (__DEV__) {
        validateFunctionComponentInDev(workInProgress, Component);
        workInProgress.type = Component = resolveFunctionForHotReloading(
          Component,
        );
      }
      child = updateFunctionComponent(
        null,
        workInProgress,
        Component,
        resolvedProps,
        renderLanes,
      );
      return child;
    }
    case ClassComponent: {
      if (__DEV__) {
        workInProgress.type = Component = resolveClassForHotReloading(
          Component,
        );
      }
      child = updateClassComponent(
        null,
        workInProgress,
        Component,
        resolvedProps,
        renderLanes,
      );
      return child;
    }
    case ForwardRef: {
      if (__DEV__) {
        workInProgress.type = Component = resolveForwardRefForHotReloading(
          Component,
        );
      }
      child = updateForwardRef(
        null,
        workInProgress,
        Component,
        resolvedProps,
        renderLanes,
      );
      return child;
    }
    case MemoComponent: {
      if (__DEV__) {
        if (workInProgress.type !== workInProgress.elementType) {
          const outerPropTypes = Component.propTypes;
          if (outerPropTypes) {
            checkPropTypes(
              outerPropTypes,
              resolvedProps, // Resolved for outer only
              'prop',
              getComponentName(Component),
            );
          }
        }
      }
      child = updateMemoComponent(
        null,
        workInProgress,
        Component,
        resolveDefaultProps(Component.type, resolvedProps), // The inner type can have defaults too
        updateLanes,
        renderLanes,
      );
      return child;
    }
    case Block: {
      if (enableBlocksAPI) {
        // TODO: Resolve for Hot Reloading.
        child = updateBlock(
          null,
          workInProgress,
          Component,
          props,
          renderLanes,
        );
        return child;
      }
      break;
    }
  }
  let hint = '';
  if (__DEV__) {
    if (
      Component !== null &&
      typeof Component === 'object' &&
      Component.$$typeof === REACT_LAZY_TYPE
    ) {
      hint = ' Did you wrap a component in React.lazy() more than once?';
    }
  }
  // This message intentionally doesn't mention ForwardRef or MemoComponent
  // because the fact that it's a separate type of work is an
  // implementation detail.
  invariant(
    false,
    'Element type is invalid. Received a promise that resolves to: %s. ' +
      'Lazy element type must resolve to a class or function.%s',
    Component,
    hint,
  );
}

function mountIncompleteClassComponent(
  _current,
  workInProgress,
  Component,
  nextProps,
  renderLanes,
) {
  if (_current !== null) {
    // An incomplete component only mounts if it suspended inside a non-
    // concurrent tree, in an inconsistent state. We want to treat it like
    // a new mount, even though an empty version of it already committed.
    // Disconnect the alternate pointers.
    _current.alternate = null;
    workInProgress.alternate = null;
    // Since this is conceptually a new fiber, schedule a Placement effect
    workInProgress.flags |= Placement;
  }

  // Promote the fiber to a class and try rendering again.
  workInProgress.tag = ClassComponent;

  // The rest of this function is a fork of `updateClassComponent`

  // Push context providers early to prevent context stack mismatches.
  // During mounting we don't know the child context yet as the instance doesn't exist.
  // We will invalidate the child context in finishClassComponent() right after rendering.
  let hasContext;
  if (isLegacyContextProvider(Component)) {
    hasContext = true;
    pushLegacyContextProvider(workInProgress);
  } else {
    hasContext = false;
  }
  prepareToReadContext(workInProgress, renderLanes);

  constructClassInstance(workInProgress, Component, nextProps);
  mountClassInstance(workInProgress, Component, nextProps, renderLanes);

  return finishClassComponent(
    null,
    workInProgress,
    Component,
    true,
    hasContext,
    renderLanes,
  );
}

// 不确定是函数组件还是类组件
function mountIndeterminateComponent(
  _current, // currentFiber
  workInProgress,
  Component,
  renderLanes,
) {
  if (_current !== null) {
    // An indeterminate component only mounts if it suspended inside a non-
    // concurrent tree, in an inconsistent state. We want to treat it like
    // a new mount, even though an empty version of it already committed.
    // Disconnect the alternate pointers.
    _current.alternate = null;
    workInProgress.alternate = null;
    // Since this is conceptually a new fiber, schedule a Placement effect
    workInProgress.flags |= Placement;
  }

  const props = workInProgress.pendingProps;
  let context;
  if (!disableLegacyContext) {
    const unmaskedContext = getUnmaskedContext(
      workInProgress,
      Component,
      false,
    );
    context = getMaskedContext(workInProgress, unmaskedContext);
  }

  prepareToReadContext(workInProgress, renderLanes);
  let value;

  if (__DEV__) {
    if (
      Component.prototype &&
      typeof Component.prototype.render === 'function'
    ) {
      const componentName = getComponentName(Component) || 'Unknown';

      if (!didWarnAboutBadClass[componentName]) {
        console.error(
          "The <%s /> component appears to have a render method, but doesn't extend React.Component. " +
            'This is likely to cause errors. Change %s to extend React.Component instead.',
          componentName,
          componentName,
        );
        didWarnAboutBadClass[componentName] = true;
      }
    }

    if (workInProgress.mode & StrictMode) {
      ReactStrictModeWarnings.recordLegacyContextWarning(workInProgress, null);
    }

    setIsRendering(true);
    ReactCurrentOwner.current = workInProgress;
    value = renderWithHooks(
      null,
      workInProgress,
      Component,
      props,
      context,
      renderLanes,
    );
    setIsRendering(false);
  } else {
    value = renderWithHooks(
      null,
      workInProgress,
      Component,
      props,
      context,
      renderLanes,
    );
  }
  // React DevTools reads this flag.
  workInProgress.flags |= PerformedWork;

  if (__DEV__) {
    // Support for module components is deprecated and is removed behind a flag.
    // Whether or not it would crash later, we want to show a good message in DEV first.
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof value.render === 'function' &&
      value.$$typeof === undefined
    ) {
      const componentName = getComponentName(Component) || 'Unknown';
      if (!didWarnAboutModulePatternComponent[componentName]) {
        console.error(
          'The <%s /> component appears to be a function component that returns a class instance. ' +
            'Change %s to a class that extends React.Component instead. ' +
            "If you can't use a class try assigning the prototype on the function as a workaround. " +
            "`%s.prototype = React.Component.prototype`. Don't use an arrow function since it " +
            'cannot be called with `new` by React.',
          componentName,
          componentName,
          componentName,
        );
        didWarnAboutModulePatternComponent[componentName] = true;
      }
    }
  }

  if (
    // Run these checks in production only if the flag is off.
    // Eventually we'll delete this branch altogether.
    !disableModulePatternComponents &&
    typeof value === 'object' &&
    value !== null &&
    typeof value.render === 'function' &&
    value.$$typeof === undefined
  ) {
    if (__DEV__) {
      const componentName = getComponentName(Component) || 'Unknown';
      if (!didWarnAboutModulePatternComponent[componentName]) {
        console.error(
          'The <%s /> component appears to be a function component that returns a class instance. ' +
            'Change %s to a class that extends React.Component instead. ' +
            "If you can't use a class try assigning the prototype on the function as a workaround. " +
            "`%s.prototype = React.Component.prototype`. Don't use an arrow function since it " +
            'cannot be called with `new` by React.',
          componentName,
          componentName,
          componentName,
        );
        didWarnAboutModulePatternComponent[componentName] = true;
      }
    }

    // Proceed under the assumption that this is a class instance
    workInProgress.tag = ClassComponent;

    // Throw out any hooks that were used.
    workInProgress.memoizedState = null;
    workInProgress.updateQueue = null;

    // Push context providers early to prevent context stack mismatches.
    // During mounting we don't know the child context yet as the instance doesn't exist.
    // We will invalidate the child context in finishClassComponent() right after rendering.
    let hasContext = false;
    if (isLegacyContextProvider(Component)) {
      hasContext = true;
      pushLegacyContextProvider(workInProgress);
    } else {
      hasContext = false;
    }

    workInProgress.memoizedState =
      value.state !== null && value.state !== undefined ? value.state : null;

    initializeUpdateQueue(workInProgress);

    const getDerivedStateFromProps = Component.getDerivedStateFromProps;
    if (typeof getDerivedStateFromProps === 'function') {
      applyDerivedStateFromProps(
        workInProgress,
        Component,
        getDerivedStateFromProps,
        props,
      );
    }

    adoptClassInstance(workInProgress, value);
    mountClassInstance(workInProgress, Component, props, renderLanes);
    return finishClassComponent(
      null,
      workInProgress,
      Component,
      true,
      hasContext,
      renderLanes,
    );
  } else {
    // Proceed under the assumption that this is a function component
    workInProgress.tag = FunctionComponent;
    if (__DEV__) {
      if (disableLegacyContext && Component.contextTypes) {
        console.error(
          '%s uses the legacy contextTypes API which is no longer supported. ' +
            'Use React.createContext() with React.useContext() instead.',
          getComponentName(Component) || 'Unknown',
        );
      }

      if (
        debugRenderPhaseSideEffectsForStrictMode &&
        workInProgress.mode & StrictMode
      ) {
        disableLogs();
        try {
          value = renderWithHooks(
            null,
            workInProgress,
            Component,
            props,
            context,
            renderLanes,
          );
        } finally {
          reenableLogs();
        }
      }
    }
    reconcileChildren(null, workInProgress, value, renderLanes);
    if (__DEV__) {
      validateFunctionComponentInDev(workInProgress, Component);
    }
    return workInProgress.child;
  }
}

function validateFunctionComponentInDev(workInProgress: Fiber, Component: any) {
  if (__DEV__) {
    if (Component) {
      if (Component.childContextTypes) {
        console.error(
          '%s(...): childContextTypes cannot be defined on a function component.',
          Component.displayName || Component.name || 'Component',
        );
      }
    }
    if (workInProgress.ref !== null) {
      let info = '';
      const ownerName = getCurrentFiberOwnerNameInDevOrNull();
      if (ownerName) {
        info += '\n\nCheck the render method of `' + ownerName + '`.';
      }

      let warningKey = ownerName || workInProgress._debugID || '';
      const debugSource = workInProgress._debugSource;
      if (debugSource) {
        warningKey = debugSource.fileName + ':' + debugSource.lineNumber;
      }
      if (!didWarnAboutFunctionRefs[warningKey]) {
        didWarnAboutFunctionRefs[warningKey] = true;
        console.error(
          'Function components cannot be given refs. ' +
            'Attempts to access this ref will fail. ' +
            'Did you mean to use React.forwardRef()?%s',
          info,
        );
      }
    }

    if (
      warnAboutDefaultPropsOnFunctionComponents &&
      Component.defaultProps !== undefined
    ) {
      const componentName = getComponentName(Component) || 'Unknown';

      if (!didWarnAboutDefaultPropsOnFunctionComponent[componentName]) {
        console.error(
          '%s: Support for defaultProps will be removed from function components ' +
            'in a future major release. Use JavaScript default parameters instead.',
          componentName,
        );
        didWarnAboutDefaultPropsOnFunctionComponent[componentName] = true;
      }
    }

    if (typeof Component.getDerivedStateFromProps === 'function') {
      const componentName = getComponentName(Component) || 'Unknown';

      if (!didWarnAboutGetDerivedStateOnFunctionComponent[componentName]) {
        console.error(
          '%s: Function components do not support getDerivedStateFromProps.',
          componentName,
        );
        didWarnAboutGetDerivedStateOnFunctionComponent[componentName] = true;
      }
    }

    if (
      typeof Component.contextType === 'object' &&
      Component.contextType !== null
    ) {
      const componentName = getComponentName(Component) || 'Unknown';

      if (!didWarnAboutContextTypeOnFunctionComponent[componentName]) {
        console.error(
          '%s: Function components do not support contextType.',
          componentName,
        );
        didWarnAboutContextTypeOnFunctionComponent[componentName] = true;
      }
    }
  }
}

const SUSPENDED_MARKER: SuspenseState = {
  dehydrated: null,
  retryLane: NoLane,
};

function mountSuspenseOffscreenState(renderLanes: Lanes): OffscreenState {
  return {
    baseLanes: renderLanes,
  };
}

function updateSuspenseOffscreenState(
  prevOffscreenState: OffscreenState,
  renderLanes: Lanes,
): OffscreenState {
  return {
    baseLanes: mergeLanes(prevOffscreenState.baseLanes, renderLanes),
  };
}

// TODO: Probably should inline this back
function shouldRemainOnFallback(
  suspenseContext: SuspenseContext,
  current: null | Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  // If we're already showing a fallback, there are cases where we need to
  // remain on that fallback regardless of whether the content has resolved.
  // For example, SuspenseList coordinates when nested content appears.
  if (current !== null) {
    const suspenseState: SuspenseState = current.memoizedState;
    if (suspenseState === null) {
      // Currently showing content. Don't hide it, even if ForceSuspenseFallack
      // is true. More precise name might be "ForceRemainSuspenseFallback".
      // Note: This is a factoring smell. Can't remain on a fallback if there's
      // no fallback to remain on.
      return false;
    }
  }

  // Not currently showing content. Consult the Suspense context.
  return hasSuspenseContext(
    suspenseContext,
    (ForceSuspenseFallback: SuspenseContext),
  );
}

function getRemainingWorkInPrimaryTree(current: Fiber, renderLanes) {
  // TODO: Should not remove render lanes that were pinged during this render
  return removeLanes(current.childLanes, renderLanes);
}

function updateSuspenseComponent(current, workInProgress, renderLanes) {
  // 新props
  const nextProps = workInProgress.pendingProps;

  // This is used by DevTools to force a boundary to suspend.
  if (__DEV__) {
    if (shouldSuspend(workInProgress)) {
      workInProgress.flags |= DidCapture;
    }
  }

  // suspense上下文
  let suspenseContext: SuspenseContext = suspenseStackCursor.current;

  let showFallback = false;
  const didSuspend = (workInProgress.flags & DidCapture) !== NoFlags;

  if (
    didSuspend ||
    shouldRemainOnFallback(
      suspenseContext,
      current,
      workInProgress,
      renderLanes,
    )
  ) {
    // Something in this boundary's subtree already suspended. Switch to
    // rendering the fallback children.
    showFallback = true;
    workInProgress.flags &= ~DidCapture;
  } else {
    // Attempting the main content
    if (
      current === null ||
      (current.memoizedState: null | SuspenseState) !== null
    ) {
      // This is a new mount or this boundary is already showing a fallback state.
      // Mark this subtree context as having at least one invisible parent that could
      // handle the fallback state.
      // Boundaries without fallbacks or should be avoided are not considered since
      // they cannot handle preferred fallback states.
      if (
        nextProps.fallback !== undefined &&
        nextProps.unstable_avoidThisFallback !== true
      ) {
        suspenseContext = addSubtreeSuspenseContext(
          suspenseContext,
          InvisibleParentSuspenseContext,
        );
      }
    }
  }

  suspenseContext = setDefaultShallowSuspenseContext(suspenseContext);

  pushSuspenseContext(workInProgress, suspenseContext);

  // OK, the next part is confusing. We're about to reconcile the Suspense
  // boundary's children. This involves some custom reconcilation logic. Two
  // main reasons this is so complicated.
  //
  // First, Legacy Mode has different semantics for backwards compatibility. The
  // primary tree will commit in an inconsistent state, so when we do the
  // second pass to render the fallback, we do some exceedingly, uh, clever
  // hacks to make that not totally break. Like transferring effects and
  // deletions from hidden tree. In Concurrent Mode, it's much simpler,
  // because we bailout on the primary tree completely and leave it in its old
  // state, no effects. Same as what we do for Offscreen (except that
  // Offscreen doesn't have the first render pass).
  //
  // Second is hydration. During hydration, the Suspense fiber has a slightly
  // different layout, where the child points to a dehydrated fragment, which
  // contains the DOM rendered by the server.
  //
  // Third, even if you set all that aside, Suspense is like error boundaries in
  // that we first we try to render one tree, and if that fails, we render again
  // and switch to a different tree. Like a try/catch block. So we have to track
  // which branch we're currently rendering. Ideally we would model this using
  // a stack.
  if (current === null) {
    // Initial mount
    // 初次渲染

    // If we're currently hydrating, try to hydrate this boundary.
    // But only if this has a fallback.

    if (nextProps.fallback !== undefined) {
      tryToClaimNextHydratableInstance(workInProgress);
      // This could've been a dehydrated suspense component.
      if (enableSuspenseServerRenderer) {
        const suspenseState: null | SuspenseState =
          workInProgress.memoizedState;
        if (suspenseState !== null) {
          const dehydrated = suspenseState.dehydrated;
          if (dehydrated !== null) {
            return mountDehydratedSuspenseComponent(
              workInProgress,
              dehydrated,
              renderLanes,
            );
          }
        }
      }
    }

    const nextPrimaryChildren = nextProps.children;
    const nextFallbackChildren = nextProps.fallback;
    if (showFallback) {
      const fallbackFragment = mountSuspenseFallbackChildren(
        workInProgress,
        nextPrimaryChildren,
        nextFallbackChildren,
        renderLanes,
      );
      const primaryChildFragment: Fiber = (workInProgress.child: any);
      primaryChildFragment.memoizedState = mountSuspenseOffscreenState(
        renderLanes,
      );
      workInProgress.memoizedState = SUSPENDED_MARKER;
      return fallbackFragment;
    } else if (typeof nextProps.unstable_expectedLoadTime === 'number') {
      // This is a CPU-bound tree. Skip this tree and show a placeholder to
      // unblock the surrounding content. Then immediately retry after the
      // initial commit.
      const fallbackFragment = mountSuspenseFallbackChildren(
        workInProgress,
        nextPrimaryChildren,
        nextFallbackChildren,
        renderLanes,
      );
      const primaryChildFragment: Fiber = (workInProgress.child: any);
      primaryChildFragment.memoizedState = mountSuspenseOffscreenState(
        renderLanes,
      );
      workInProgress.memoizedState = SUSPENDED_MARKER;

      // Since nothing actually suspended, there will nothing to ping this to
      // get it started back up to attempt the next item. While in terms of
      // priority this work has the same priority as this current render, it's
      // not part of the same transition once the transition has committed. If
      // it's sync, we still want to yield so that it can be painted.
      // Conceptually, this is really the same as pinging. We can use any
      // RetryLane even if it's the one currently rendering since we're leaving
      // it behind on this node.
      workInProgress.lanes = SomeRetryLane;
      if (enableSchedulerTracing) {
        markSpawnedWork(SomeRetryLane);
      }
      return fallbackFragment;
    } else {
      return mountSuspensePrimaryChildren(
        workInProgress,
        nextPrimaryChildren,
        renderLanes,
      );
    }
  } else {
    // This is an update.
    // 更新渲染

    // If the current fiber has a SuspenseState, that means it's already showing
    // a fallback.
    const prevState: null | SuspenseState = current.memoizedState;
    if (prevState !== null) {
      // The current tree is already showing a fallback

      // Special path for hydration
      if (enableSuspenseServerRenderer) {
        const dehydrated = prevState.dehydrated;
        if (dehydrated !== null) {
          if (!didSuspend) {
            return updateDehydratedSuspenseComponent(
              current,
              workInProgress,
              dehydrated,
              prevState,
              renderLanes,
            );
          } else if (
            (workInProgress.memoizedState: null | SuspenseState) !== null
          ) {
            // Something suspended and we should still be in dehydrated mode.
            // Leave the existing child in place.
            workInProgress.child = current.child;
            // The dehydrated completion pass expects this flag to be there
            // but the normal suspense pass doesn't.
            workInProgress.flags |= DidCapture;
            return null;
          } else {
            // Suspended but we should no longer be in dehydrated mode.
            // Therefore we now have to render the fallback.
            const nextPrimaryChildren = nextProps.children;
            const nextFallbackChildren = nextProps.fallback;
            const fallbackChildFragment = mountSuspenseFallbackAfterRetryWithoutHydrating(
              current,
              workInProgress,
              nextPrimaryChildren,
              nextFallbackChildren,
              renderLanes,
            );
            const primaryChildFragment: Fiber = (workInProgress.child: any);
            primaryChildFragment.memoizedState = mountSuspenseOffscreenState(
              renderLanes,
            );
            workInProgress.memoizedState = SUSPENDED_MARKER;
            return fallbackChildFragment;
          }
        }
      }

      if (showFallback) {
        const nextFallbackChildren = nextProps.fallback;
        const nextPrimaryChildren = nextProps.children;
        const fallbackChildFragment = updateSuspenseFallbackChildren(
          current,
          workInProgress,
          nextPrimaryChildren,
          nextFallbackChildren,
          renderLanes,
        );
        const primaryChildFragment: Fiber = (workInProgress.child: any);
        const prevOffscreenState: OffscreenState | null = (current.child: any)
          .memoizedState;
        primaryChildFragment.memoizedState =
          prevOffscreenState === null
            ? mountSuspenseOffscreenState(renderLanes)
            : updateSuspenseOffscreenState(prevOffscreenState, renderLanes);
        primaryChildFragment.childLanes = getRemainingWorkInPrimaryTree(
          current,
          renderLanes,
        );
        workInProgress.memoizedState = SUSPENDED_MARKER;
        return fallbackChildFragment;
      } else {
        const nextPrimaryChildren = nextProps.children;
        const primaryChildFragment = updateSuspensePrimaryChildren(
          current,
          workInProgress,
          nextPrimaryChildren,
          renderLanes,
        );
        workInProgress.memoizedState = null;
        return primaryChildFragment;
      }
    } else {
      // The current tree is not already showing a fallback.
      if (showFallback) {
        // Timed out.
        const nextFallbackChildren = nextProps.fallback;
        const nextPrimaryChildren = nextProps.children;
        const fallbackChildFragment = updateSuspenseFallbackChildren(
          current,
          workInProgress,
          nextPrimaryChildren,
          nextFallbackChildren,
          renderLanes,
        );
        const primaryChildFragment: Fiber = (workInProgress.child: any);
        const prevOffscreenState: OffscreenState | null = (current.child: any)
          .memoizedState;
        primaryChildFragment.memoizedState =
          prevOffscreenState === null
            ? mountSuspenseOffscreenState(renderLanes)
            : updateSuspenseOffscreenState(prevOffscreenState, renderLanes);
        primaryChildFragment.childLanes = getRemainingWorkInPrimaryTree(
          current,
          renderLanes,
        );
        // Skip the primary children, and continue working on the
        // fallback children.
        workInProgress.memoizedState = SUSPENDED_MARKER;
        return fallbackChildFragment;
      } else {
        // Still haven't timed out. Continue rendering the children, like we
        // normally do.
        const nextPrimaryChildren = nextProps.children;
        const primaryChildFragment = updateSuspensePrimaryChildren(
          current,
          workInProgress,
          nextPrimaryChildren,
          renderLanes,
        );
        workInProgress.memoizedState = null;
        return primaryChildFragment;
      }
    }
  }
}

function mountSuspensePrimaryChildren(
  workInProgress,
  primaryChildren,
  renderLanes,
) {
  const mode = workInProgress.mode;
  const primaryChildProps: OffscreenProps = {
    mode: 'visible',
    children: primaryChildren,
  };
  const primaryChildFragment = createFiberFromOffscreen(
    primaryChildProps,
    mode,
    renderLanes,
    null,
  );
  primaryChildFragment.return = workInProgress;
  workInProgress.child = primaryChildFragment;
  return primaryChildFragment;
}

function mountSuspenseFallbackChildren(
  workInProgress,
  primaryChildren,
  fallbackChildren,
  renderLanes,
) {
  const mode = workInProgress.mode;
  const progressedPrimaryFragment: Fiber | null = workInProgress.child;

  const primaryChildProps: OffscreenProps = {
    mode: 'hidden',
    children: primaryChildren,
  };

  let primaryChildFragment;
  let fallbackChildFragment;
  if ((mode & BlockingMode) === NoMode && progressedPrimaryFragment !== null) {
    // In legacy mode, we commit the primary tree as if it successfully
    // completed, even though it's in an inconsistent state.
    primaryChildFragment = progressedPrimaryFragment;
    primaryChildFragment.childLanes = NoLanes;
    primaryChildFragment.pendingProps = primaryChildProps;

    if (enableProfilerTimer && workInProgress.mode & ProfileMode) {
      // Reset the durations from the first pass so they aren't included in the
      // final amounts. This seems counterintuitive, since we're intentionally
      // not measuring part of the render phase, but this makes it match what we
      // do in Concurrent Mode.
      primaryChildFragment.actualDuration = 0;
      primaryChildFragment.actualStartTime = -1;
      primaryChildFragment.selfBaseDuration = 0;
      primaryChildFragment.treeBaseDuration = 0;
    }

    fallbackChildFragment = createFiberFromFragment(
      fallbackChildren,
      mode,
      renderLanes,
      null,
    );
  } else {
    primaryChildFragment = createFiberFromOffscreen(
      primaryChildProps,
      mode,
      NoLanes,
      null,
    );
    fallbackChildFragment = createFiberFromFragment(
      fallbackChildren,
      mode,
      renderLanes,
      null,
    );
  }

  primaryChildFragment.return = workInProgress;
  fallbackChildFragment.return = workInProgress;
  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;
  return fallbackChildFragment;
}

function createWorkInProgressOffscreenFiber(
  current: Fiber,
  offscreenProps: OffscreenProps,
) {
  // The props argument to `createWorkInProgress` is `any` typed, so we use this
  // wrapper function to constrain it.
  return createWorkInProgress(current, offscreenProps);
}

function updateSuspensePrimaryChildren(
  current,
  workInProgress,
  primaryChildren,
  renderLanes,
) {
  const currentPrimaryChildFragment: Fiber = (current.child: any);
  const currentFallbackChildFragment: Fiber | null =
    currentPrimaryChildFragment.sibling;

  const primaryChildFragment = createWorkInProgressOffscreenFiber(
    currentPrimaryChildFragment,
    {
      mode: 'visible',
      children: primaryChildren,
    },
  );
  if ((workInProgress.mode & BlockingMode) === NoMode) {
    primaryChildFragment.lanes = renderLanes;
  }
  primaryChildFragment.return = workInProgress;
  primaryChildFragment.sibling = null;
  if (currentFallbackChildFragment !== null) {
    // Delete the fallback child fragment
    currentFallbackChildFragment.nextEffect = null;
    currentFallbackChildFragment.flags = Deletion;
    workInProgress.firstEffect = workInProgress.lastEffect = currentFallbackChildFragment;
  }

  workInProgress.child = primaryChildFragment;
  return primaryChildFragment;
}

function updateSuspenseFallbackChildren(
  current,
  workInProgress,
  primaryChildren,
  fallbackChildren,
  renderLanes,
) {
  const mode = workInProgress.mode;
  const currentPrimaryChildFragment: Fiber = (current.child: any);
  const currentFallbackChildFragment: Fiber | null =
    currentPrimaryChildFragment.sibling;

  const primaryChildProps: OffscreenProps = {
    mode: 'hidden',
    children: primaryChildren,
  };

  let primaryChildFragment;
  if (
    // In legacy mode, we commit the primary tree as if it successfully
    // completed, even though it's in an inconsistent state.
    (mode & BlockingMode) === NoMode &&
    // Make sure we're on the second pass, i.e. the primary child fragment was
    // already cloned. In legacy mode, the only case where this isn't true is
    // when DevTools forces us to display a fallback; we skip the first render
    // pass entirely and go straight to rendering the fallback. (In Concurrent
    // Mode, SuspenseList can also trigger this scenario, but this is a legacy-
    // only codepath.)
    workInProgress.child !== currentPrimaryChildFragment
  ) {
    const progressedPrimaryFragment: Fiber = (workInProgress.child: any);
    primaryChildFragment = progressedPrimaryFragment;
    primaryChildFragment.childLanes = NoLanes;
    primaryChildFragment.pendingProps = primaryChildProps;

    if (enableProfilerTimer && workInProgress.mode & ProfileMode) {
      // Reset the durations from the first pass so they aren't included in the
      // final amounts. This seems counterintuitive, since we're intentionally
      // not measuring part of the render phase, but this makes it match what we
      // do in Concurrent Mode.
      primaryChildFragment.actualDuration = 0;
      primaryChildFragment.actualStartTime = -1;
      primaryChildFragment.selfBaseDuration =
        currentPrimaryChildFragment.selfBaseDuration;
      primaryChildFragment.treeBaseDuration =
        currentPrimaryChildFragment.treeBaseDuration;
    }

    // The fallback fiber was added as a deletion effect during the first pass.
    // However, since we're going to remain on the fallback, we no longer want
    // to delete it. So we need to remove it from the list. Deletions are stored
    // on the same list as effects. We want to keep the effects from the primary
    // tree. So we copy the primary child fragment's effect list, which does not
    // include the fallback deletion effect.
    const progressedLastEffect = primaryChildFragment.lastEffect;
    if (progressedLastEffect !== null) {
      workInProgress.firstEffect = primaryChildFragment.firstEffect;
      workInProgress.lastEffect = progressedLastEffect;
      progressedLastEffect.nextEffect = null;
    } else {
      // TODO: Reset this somewhere else? Lol legacy mode is so weird.
      workInProgress.firstEffect = workInProgress.lastEffect = null;
    }
  } else {
    primaryChildFragment = createWorkInProgressOffscreenFiber(
      currentPrimaryChildFragment,
      primaryChildProps,
    );
  }
  let fallbackChildFragment;
  if (currentFallbackChildFragment !== null) {
    fallbackChildFragment = createWorkInProgress(
      currentFallbackChildFragment,
      fallbackChildren,
    );
  } else {
    fallbackChildFragment = createFiberFromFragment(
      fallbackChildren,
      mode,
      renderLanes,
      null,
    );
    // Needs a placement effect because the parent (the Suspense boundary) already
    // mounted but this is a new fiber.
    fallbackChildFragment.flags |= Placement;
  }

  fallbackChildFragment.return = workInProgress;
  primaryChildFragment.return = workInProgress;
  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;

  return fallbackChildFragment;
}

function retrySuspenseComponentWithoutHydrating(
  current: Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  // This will add the old fiber to the deletion list
  reconcileChildFibers(workInProgress, current.child, null, renderLanes);

  // We're now not suspended nor dehydrated.
  const nextProps = workInProgress.pendingProps;
  const primaryChildren = nextProps.children;
  const primaryChildFragment = mountSuspensePrimaryChildren(
    workInProgress,
    primaryChildren,
    renderLanes,
  );
  // Needs a placement effect because the parent (the Suspense boundary) already
  // mounted but this is a new fiber.
  primaryChildFragment.flags |= Placement;
  workInProgress.memoizedState = null;

  return primaryChildFragment;
}

function mountSuspenseFallbackAfterRetryWithoutHydrating(
  current,
  workInProgress,
  primaryChildren,
  fallbackChildren,
  renderLanes,
) {
  const mode = workInProgress.mode;
  const primaryChildFragment = createFiberFromOffscreen(
    primaryChildren,
    mode,
    NoLanes,
    null,
  );
  const fallbackChildFragment = createFiberFromFragment(
    fallbackChildren,
    mode,
    renderLanes,
    null,
  );
  // Needs a placement effect because the parent (the Suspense
  // boundary) already mounted but this is a new fiber.
  fallbackChildFragment.flags |= Placement;

  primaryChildFragment.return = workInProgress;
  fallbackChildFragment.return = workInProgress;
  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;

  if ((workInProgress.mode & BlockingMode) !== NoMode) {
    // We will have dropped the effect list which contains the
    // deletion. We need to reconcile to delete the current child.
    reconcileChildFibers(workInProgress, current.child, null, renderLanes);
  }

  return fallbackChildFragment;
}

function mountDehydratedSuspenseComponent(
  workInProgress: Fiber,
  suspenseInstance: SuspenseInstance,
  renderLanes: Lanes,
): null | Fiber {
  // During the first pass, we'll bail out and not drill into the children.
  // Instead, we'll leave the content in place and try to hydrate it later.
  if ((workInProgress.mode & BlockingMode) === NoMode) {
    if (__DEV__) {
      console.error(
        'Cannot hydrate Suspense in legacy mode. Switch from ' +
          'ReactDOM.hydrate(element, container) to ' +
          'ReactDOM.createBlockingRoot(container, { hydrate: true })' +
          '.render(element) or remove the Suspense components from ' +
          'the server rendered components.',
      );
    }
    workInProgress.lanes = laneToLanes(SyncLane);
  } else if (isSuspenseInstanceFallback(suspenseInstance)) {
    // This is a client-only boundary. Since we won't get any content from the server
    // for this, we need to schedule that at a higher priority based on when it would
    // have timed out. In theory we could render it in this pass but it would have the
    // wrong priority associated with it and will prevent hydration of parent path.
    // Instead, we'll leave work left on it to render it in a separate commit.

    // TODO This time should be the time at which the server rendered response that is
    // a parent to this boundary was displayed. However, since we currently don't have
    // a protocol to transfer that time, we'll just estimate it by using the current
    // time. This will mean that Suspense timeouts are slightly shifted to later than
    // they should be.
    // Schedule a normal pri update to render this content.
    if (enableSchedulerTracing) {
      markSpawnedWork(DefaultHydrationLane);
    }
    workInProgress.lanes = laneToLanes(DefaultHydrationLane);
  } else {
    // We'll continue hydrating the rest at offscreen priority since we'll already
    // be showing the right content coming from the server, it is no rush.
    workInProgress.lanes = laneToLanes(OffscreenLane);
    if (enableSchedulerTracing) {
      markSpawnedWork(OffscreenLane);
    }
  }
  return null;
}

function updateDehydratedSuspenseComponent(
  current: Fiber,
  workInProgress: Fiber,
  suspenseInstance: SuspenseInstance,
  suspenseState: SuspenseState,
  renderLanes: Lanes,
): null | Fiber {
  // We should never be hydrating at this point because it is the first pass,
  // but after we've already committed once.
  warnIfHydrating();

  if ((getExecutionContext() & RetryAfterError) !== NoContext) {
    return retrySuspenseComponentWithoutHydrating(
      current,
      workInProgress,
      renderLanes,
    );
  }

  if ((workInProgress.mode & BlockingMode) === NoMode) {
    return retrySuspenseComponentWithoutHydrating(
      current,
      workInProgress,
      renderLanes,
    );
  }

  if (isSuspenseInstanceFallback(suspenseInstance)) {
    // This boundary is in a permanent fallback state. In this case, we'll never
    // get an update and we'll never be able to hydrate the final content. Let's just try the
    // client side render instead.
    return retrySuspenseComponentWithoutHydrating(
      current,
      workInProgress,
      renderLanes,
    );
  }
  // We use lanes to indicate that a child might depend on context, so if
  // any context has changed, we need to treat is as if the input might have changed.
  const hasContextChanged = includesSomeLane(renderLanes, current.childLanes);
  if (didReceiveUpdate || hasContextChanged) {
    // This boundary has changed since the first render. This means that we are now unable to
    // hydrate it. We might still be able to hydrate it using a higher priority lane.
    const root = getWorkInProgressRoot();
    if (root !== null) {
      const attemptHydrationAtLane = getBumpedLaneForHydration(
        root,
        renderLanes,
      );
      if (
        attemptHydrationAtLane !== NoLane &&
        attemptHydrationAtLane !== suspenseState.retryLane
      ) {
        // Intentionally mutating since this render will get interrupted. This
        // is one of the very rare times where we mutate the current tree
        // during the render phase.
        suspenseState.retryLane = attemptHydrationAtLane;
        // TODO: Ideally this would inherit the event time of the current render
        const eventTime = NoTimestamp;
        scheduleUpdateOnFiber(current, attemptHydrationAtLane, eventTime);
      } else {
        // We have already tried to ping at a higher priority than we're rendering with
        // so if we got here, we must have failed to hydrate at those levels. We must
        // now give up. Instead, we're going to delete the whole subtree and instead inject
        // a new real Suspense boundary to take its place, which may render content
        // or fallback. This might suspend for a while and if it does we might still have
        // an opportunity to hydrate before this pass commits.
      }
    }

    // If we have scheduled higher pri work above, this will probably just abort the render
    // since we now have higher priority work, but in case it doesn't, we need to prepare to
    // render something, if we time out. Even if that requires us to delete everything and
    // skip hydration.
    // Delay having to do this as long as the suspense timeout allows us.
    renderDidSuspendDelayIfPossible();
    return retrySuspenseComponentWithoutHydrating(
      current,
      workInProgress,
      renderLanes,
    );
  } else if (isSuspenseInstancePending(suspenseInstance)) {
    // This component is still pending more data from the server, so we can't hydrate its
    // content. We treat it as if this component suspended itself. It might seem as if
    // we could just try to render it client-side instead. However, this will perform a
    // lot of unnecessary work and is unlikely to complete since it often will suspend
    // on missing data anyway. Additionally, the server might be able to render more
    // than we can on the client yet. In that case we'd end up with more fallback states
    // on the client than if we just leave it alone. If the server times out or errors
    // these should update this boundary to the permanent Fallback state instead.
    // Mark it as having captured (i.e. suspended).
    workInProgress.flags |= DidCapture;
    // Leave the child in place. I.e. the dehydrated fragment.
    workInProgress.child = current.child;
    // Register a callback to retry this boundary once the server has sent the result.
    let retry = retryDehydratedSuspenseBoundary.bind(null, current);
    if (enableSchedulerTracing) {
      retry = Schedule_tracing_wrap(retry);
    }
    registerSuspenseInstanceRetry(suspenseInstance, retry);
    return null;
  } else {
    // This is the first attempt.
    reenterHydrationStateFromDehydratedSuspenseInstance(
      workInProgress,
      suspenseInstance,
    );
    const nextProps = workInProgress.pendingProps;
    const primaryChildren = nextProps.children;
    const primaryChildFragment = mountSuspensePrimaryChildren(
      workInProgress,
      primaryChildren,
      renderLanes,
    );
    // Mark the children as hydrating. This is a fast path to know whether this
    // tree is part of a hydrating tree. This is used to determine if a child
    // node has fully mounted yet, and for scheduling event replaying.
    // Conceptually this is similar to Placement in that a new subtree is
    // inserted into the React tree here. It just happens to not need DOM
    // mutations because it already exists.
    primaryChildFragment.flags |= Hydrating;
    return primaryChildFragment;
  }
}

function scheduleWorkOnFiber(fiber: Fiber, renderLanes: Lanes) {
  fiber.lanes = mergeLanes(fiber.lanes, renderLanes);
  const alternate = fiber.alternate;
  if (alternate !== null) {
    alternate.lanes = mergeLanes(alternate.lanes, renderLanes);
  }
  scheduleWorkOnParentPath(fiber.return, renderLanes);
}

function propagateSuspenseContextChange(
  workInProgress: Fiber,
  firstChild: null | Fiber,
  renderLanes: Lanes,
): void {
  // Mark any Suspense boundaries with fallbacks as having work to do.
  // If they were previously forced into fallbacks, they may now be able
  // to unblock.
  let node = firstChild;
  while (node !== null) {
    if (node.tag === SuspenseComponent) {
      const state: SuspenseState | null = node.memoizedState;
      if (state !== null) {
        scheduleWorkOnFiber(node, renderLanes);
      }
    } else if (node.tag === SuspenseListComponent) {
      // If the tail is hidden there might not be an Suspense boundaries
      // to schedule work on. In this case we have to schedule it on the
      // list itself.
      // We don't have to traverse to the children of the list since
      // the list will propagate the change when it rerenders.
      scheduleWorkOnFiber(node, renderLanes);
    } else if (node.child !== null) {
      node.child.return = node;
      node = node.child;
      continue;
    }
    if (node === workInProgress) {
      return;
    }
    while (node.sibling === null) {
      if (node.return === null || node.return === workInProgress) {
        return;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

function findLastContentRow(firstChild: null | Fiber): null | Fiber {
  // This is going to find the last row among these children that is already
  // showing content on the screen, as opposed to being in fallback state or
  // new. If a row has multiple Suspense boundaries, any of them being in the
  // fallback state, counts as the whole row being in a fallback state.
  // Note that the "rows" will be workInProgress, but any nested children
  // will still be current since we haven't rendered them yet. The mounted
  // order may not be the same as the new order. We use the new order.
  let row = firstChild;
  let lastContentRow: null | Fiber = null;
  while (row !== null) {
    const currentRow = row.alternate;
    // New rows can't be content rows.
    if (currentRow !== null && findFirstSuspended(currentRow) === null) {
      lastContentRow = row;
    }
    row = row.sibling;
  }
  return lastContentRow;
}

type SuspenseListRevealOrder = 'forwards' | 'backwards' | 'together' | void;

function validateRevealOrder(revealOrder: SuspenseListRevealOrder) {
  if (__DEV__) {
    if (
      revealOrder !== undefined &&
      revealOrder !== 'forwards' &&
      revealOrder !== 'backwards' &&
      revealOrder !== 'together' &&
      !didWarnAboutRevealOrder[revealOrder]
    ) {
      didWarnAboutRevealOrder[revealOrder] = true;
      if (typeof revealOrder === 'string') {
        switch (revealOrder.toLowerCase()) {
          case 'together':
          case 'forwards':
          case 'backwards': {
            console.error(
              '"%s" is not a valid value for revealOrder on <SuspenseList />. ' +
                'Use lowercase "%s" instead.',
              revealOrder,
              revealOrder.toLowerCase(),
            );
            break;
          }
          case 'forward':
          case 'backward': {
            console.error(
              '"%s" is not a valid value for revealOrder on <SuspenseList />. ' +
                'React uses the -s suffix in the spelling. Use "%ss" instead.',
              revealOrder,
              revealOrder.toLowerCase(),
            );
            break;
          }
          default:
            console.error(
              '"%s" is not a supported revealOrder on <SuspenseList />. ' +
                'Did you mean "together", "forwards" or "backwards"?',
              revealOrder,
            );
            break;
        }
      } else {
        console.error(
          '%s is not a supported value for revealOrder on <SuspenseList />. ' +
            'Did you mean "together", "forwards" or "backwards"?',
          revealOrder,
        );
      }
    }
  }
}

function validateTailOptions(
  tailMode: SuspenseListTailMode,
  revealOrder: SuspenseListRevealOrder,
) {
  if (__DEV__) {
    if (tailMode !== undefined && !didWarnAboutTailOptions[tailMode]) {
      if (tailMode !== 'collapsed' && tailMode !== 'hidden') {
        didWarnAboutTailOptions[tailMode] = true;
        console.error(
          '"%s" is not a supported value for tail on <SuspenseList />. ' +
            'Did you mean "collapsed" or "hidden"?',
          tailMode,
        );
      } else if (revealOrder !== 'forwards' && revealOrder !== 'backwards') {
        didWarnAboutTailOptions[tailMode] = true;
        console.error(
          '<SuspenseList tail="%s" /> is only valid if revealOrder is ' +
            '"forwards" or "backwards". ' +
            'Did you mean to specify revealOrder="forwards"?',
          tailMode,
        );
      }
    }
  }
}

function validateSuspenseListNestedChild(childSlot: mixed, index: number) {
  if (__DEV__) {
    const isArray = Array.isArray(childSlot);
    const isIterable =
      !isArray && typeof getIteratorFn(childSlot) === 'function';
    if (isArray || isIterable) {
      const type = isArray ? 'array' : 'iterable';
      console.error(
        'A nested %s was passed to row #%s in <SuspenseList />. Wrap it in ' +
          'an additional SuspenseList to configure its revealOrder: ' +
          '<SuspenseList revealOrder=...> ... ' +
          '<SuspenseList revealOrder=...>{%s}</SuspenseList> ... ' +
          '</SuspenseList>',
        type,
        index,
        type,
      );
      return false;
    }
  }
  return true;
}

function validateSuspenseListChildren(
  children: mixed,
  revealOrder: SuspenseListRevealOrder,
) {
  if (__DEV__) {
    if (
      (revealOrder === 'forwards' || revealOrder === 'backwards') &&
      children !== undefined &&
      children !== null &&
      children !== false
    ) {
      if (Array.isArray(children)) {
        for (let i = 0; i < children.length; i++) {
          if (!validateSuspenseListNestedChild(children[i], i)) {
            return;
          }
        }
      } else {
        const iteratorFn = getIteratorFn(children);
        if (typeof iteratorFn === 'function') {
          const childrenIterator = iteratorFn.call(children);
          if (childrenIterator) {
            let step = childrenIterator.next();
            let i = 0;
            for (; !step.done; step = childrenIterator.next()) {
              if (!validateSuspenseListNestedChild(step.value, i)) {
                return;
              }
              i++;
            }
          }
        } else {
          console.error(
            'A single row was passed to a <SuspenseList revealOrder="%s" />. ' +
              'This is not useful since it needs multiple rows. ' +
              'Did you mean to pass multiple children or an array?',
            revealOrder,
          );
        }
      }
    }
  }
}

function initSuspenseListRenderState(
  workInProgress: Fiber,
  isBackwards: boolean,
  tail: null | Fiber,
  lastContentRow: null | Fiber,
  tailMode: SuspenseListTailMode,
  lastEffectBeforeRendering: null | Fiber,
): void {
  const renderState: null | SuspenseListRenderState =
    workInProgress.memoizedState;
  if (renderState === null) {
    workInProgress.memoizedState = ({
      isBackwards: isBackwards,
      rendering: null,
      renderingStartTime: 0,
      last: lastContentRow,
      tail: tail,
      tailMode: tailMode,
      lastEffect: lastEffectBeforeRendering,
    }: SuspenseListRenderState);
  } else {
    // We can reuse the existing object from previous renders.
    renderState.isBackwards = isBackwards;
    renderState.rendering = null;
    renderState.renderingStartTime = 0;
    renderState.last = lastContentRow;
    renderState.tail = tail;
    renderState.tailMode = tailMode;
    renderState.lastEffect = lastEffectBeforeRendering;
  }
}

// This can end up rendering this component multiple passes.
// The first pass splits the children fibers into two sets. A head and tail.
// We first render the head. If anything is in fallback state, we do another
// pass through beginWork to rerender all children (including the tail) with
// the force suspend context. If the first render didn't have anything in
// in fallback state. Then we render each row in the tail one-by-one.
// That happens in the completeWork phase without going back to beginWork.
function updateSuspenseListComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const nextProps = workInProgress.pendingProps;
  const revealOrder: SuspenseListRevealOrder = nextProps.revealOrder;
  const tailMode: SuspenseListTailMode = nextProps.tail;
  const newChildren = nextProps.children;

  validateRevealOrder(revealOrder);
  validateTailOptions(tailMode, revealOrder);
  validateSuspenseListChildren(newChildren, revealOrder);

  reconcileChildren(current, workInProgress, newChildren, renderLanes);

  let suspenseContext: SuspenseContext = suspenseStackCursor.current;

  const shouldForceFallback = hasSuspenseContext(
    suspenseContext,
    (ForceSuspenseFallback: SuspenseContext),
  );
  if (shouldForceFallback) {
    suspenseContext = setShallowSuspenseContext(
      suspenseContext,
      ForceSuspenseFallback,
    );
    workInProgress.flags |= DidCapture;
  } else {
    const didSuspendBefore =
      current !== null && (current.flags & DidCapture) !== NoFlags;
    if (didSuspendBefore) {
      // If we previously forced a fallback, we need to schedule work
      // on any nested boundaries to let them know to try to render
      // again. This is the same as context updating.
      propagateSuspenseContextChange(
        workInProgress,
        workInProgress.child,
        renderLanes,
      );
    }
    suspenseContext = setDefaultShallowSuspenseContext(suspenseContext);
  }
  pushSuspenseContext(workInProgress, suspenseContext);

  if ((workInProgress.mode & BlockingMode) === NoMode) {
    // In legacy mode, SuspenseList doesn't work so we just
    // use make it a noop by treating it as the default revealOrder.
    workInProgress.memoizedState = null;
  } else {
    switch (revealOrder) {
      case 'forwards': {
        const lastContentRow = findLastContentRow(workInProgress.child);
        let tail;
        if (lastContentRow === null) {
          // The whole list is part of the tail.
          // TODO: We could fast path by just rendering the tail now.
          tail = workInProgress.child;
          workInProgress.child = null;
        } else {
          // Disconnect the tail rows after the content row.
          // We're going to render them separately later.
          tail = lastContentRow.sibling;
          lastContentRow.sibling = null;
        }
        initSuspenseListRenderState(
          workInProgress,
          false, // isBackwards
          tail,
          lastContentRow,
          tailMode,
          workInProgress.lastEffect,
        );
        break;
      }
      case 'backwards': {
        // We're going to find the first row that has existing content.
        // At the same time we're going to reverse the list of everything
        // we pass in the meantime. That's going to be our tail in reverse
        // order.
        let tail = null;
        let row = workInProgress.child;
        workInProgress.child = null;
        while (row !== null) {
          const currentRow = row.alternate;
          // New rows can't be content rows.
          if (currentRow !== null && findFirstSuspended(currentRow) === null) {
            // This is the beginning of the main content.
            workInProgress.child = row;
            break;
          }
          const nextRow = row.sibling;
          row.sibling = tail;
          tail = row;
          row = nextRow;
        }
        // TODO: If workInProgress.child is null, we can continue on the tail immediately.
        initSuspenseListRenderState(
          workInProgress,
          true, // isBackwards
          tail,
          null, // last
          tailMode,
          workInProgress.lastEffect,
        );
        break;
      }
      case 'together': {
        initSuspenseListRenderState(
          workInProgress,
          false, // isBackwards
          null, // tail
          null, // last
          undefined,
          workInProgress.lastEffect,
        );
        break;
      }
      default: {
        // The default reveal order is the same as not having
        // a boundary.
        workInProgress.memoizedState = null;
      }
    }
  }
  return workInProgress.child;
}

function updatePortalComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  pushHostContainer(workInProgress, workInProgress.stateNode.containerInfo);
  const nextChildren = workInProgress.pendingProps;
  if (current === null) {
    // Portals are special because we don't append the children during mount
    // but at commit. Therefore we need to track insertions which the normal
    // flow doesn't do during mount. This doesn't happen at the root because
    // the root always starts with a "current" with a null child.
    // TODO: Consider unifying this with how the root works.
    workInProgress.child = reconcileChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderLanes,
    );
  } else {
    reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  }
  return workInProgress.child;
}

let hasWarnedAboutUsingNoValuePropOnContextProvider = false;

// Provider
function updateContextProvider(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const providerType: ReactProviderType<any> = workInProgress.type;
  const context: ReactContext<any> = providerType._context;

  const newProps = workInProgress.pendingProps;
  const oldProps = workInProgress.memoizedProps;

  const newValue = newProps.value;

  if (__DEV__) {
    if (!('value' in newProps)) {
      if (!hasWarnedAboutUsingNoValuePropOnContextProvider) {
        hasWarnedAboutUsingNoValuePropOnContextProvider = true;
        console.error(
          'The `value` prop is required for the `<Context.Provider>`. Did you misspell it or forget to pass it?',
        );
      }
    }
    const providerPropTypes = workInProgress.type.propTypes;

    if (providerPropTypes) {
      checkPropTypes(providerPropTypes, newProps, 'prop', 'Context.Provider');
    }
  }

  pushProvider(workInProgress, newValue);

  if (oldProps !== null) {
    const oldValue = oldProps.value;
    const changedBits = calculateChangedBits(context, newValue, oldValue);
    if (changedBits === 0) {
      // No change. Bailout early if children are the same.
      // 没有改变，直接跳出
      if (
        oldProps.children === newProps.children &&
        !hasLegacyContextChanged()
      ) {
        return bailoutOnAlreadyFinishedWork(
          current,
          workInProgress,
          renderLanes,
        );
      }
    } else {
      // The context value changed. Search for matching consumers and schedule
      // them to update.
      // 一般情况下会到这一步，context值发生改变，搜索匹配的consumers并调度这些consumers更新
      propagateContextChange(workInProgress, context, changedBits, renderLanes);
    }
  }

  // oldProps是null，或者context值发生改变
  const newChildren = newProps.children;
  // diff子节点
  reconcileChildren(current, workInProgress, newChildren, renderLanes);
  return workInProgress.child;
}

let hasWarnedAboutUsingContextAsConsumer = false;

// Consumer
function updateContextConsumer(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  let context: ReactContext<any> = workInProgress.type;
  // The logic below for Context differs depending on PROD or DEV mode. In
  // DEV mode, we create a separate object for Context.Consumer that acts
  // like a proxy to Context. This proxy object adds unnecessary code in PROD
  // so we use the old behaviour (Context.Consumer references Context) to
  // reduce size and overhead. The separate object references context via
  // a property called "_context", which also gives us the ability to check
  // in DEV mode if this property exists or not and warn if it does not.
  if (__DEV__) {
    if ((context: any)._context === undefined) {
      // This may be because it's a Context (rather than a Consumer).
      // Or it may be because it's older React where they're the same thing.
      // We only want to warn if we're sure it's a new React.
      if (context !== context.Consumer) {
        if (!hasWarnedAboutUsingContextAsConsumer) {
          hasWarnedAboutUsingContextAsConsumer = true;
          console.error(
            'Rendering <Context> directly is not supported and will be removed in ' +
              'a future major release. Did you mean to render <Context.Consumer> instead?',
          );
        }
      }
    } else {
      context = (context: any)._context;
    }
  }
  const newProps = workInProgress.pendingProps;
  const render = newProps.children;

  if (__DEV__) {
    if (typeof render !== 'function') {
      console.error(
        'A context consumer was rendered with multiple children, or a child ' +
          "that isn't a function. A context consumer expects a single child " +
          'that is a function. If you did pass a function, make sure there ' +
          'is no trailing or leading whitespace around it.',
      );
    }
  }

  prepareToReadContext(workInProgress, renderLanes);
  // unstable_observedBits 这是一个神秘的API
  const newValue = readContext(context, newProps.unstable_observedBits);
  let newChildren;
  if (__DEV__) {
    ReactCurrentOwner.current = workInProgress;
    setIsRendering(true);
    newChildren = render(newValue);
    setIsRendering(false);
  } else {
    newChildren = render(newValue);
  }

  // React DevTools reads this flag.
  workInProgress.flags |= PerformedWork;
  // diff子节点
  reconcileChildren(current, workInProgress, newChildren, renderLanes);
  return workInProgress.child;
}

function updateFundamentalComponent(current, workInProgress, renderLanes) {
  const fundamentalImpl = workInProgress.type.impl;
  if (fundamentalImpl.reconcileChildren === false) {
    return null;
  }
  const nextProps = workInProgress.pendingProps;
  const nextChildren = nextProps.children;

  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

function updateScopeComponent(current, workInProgress, renderLanes) {
  const nextProps = workInProgress.pendingProps;
  const nextChildren = nextProps.children;

  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

// didReceiveUpdate设为true，标记当前workInProgress需要接收更新
export function markWorkInProgressReceivedUpdate() {
  didReceiveUpdate = true;
}

// workInProgress的children也没有更新工作，就返回null
// workInProgress的children有更新工作，就clone出新的children并返回workInProgress.child作为下一个单元工作
function bailoutOnAlreadyFinishedWork(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
): Fiber | null {
  // 重用原有的依赖
  if (current !== null) {
    // Reuse previous dependencies
    workInProgress.dependencies = current.dependencies;
  }

  // 停止计算时间
  if (enableProfilerTimer) {
    // Don't update "base" render times for bailouts.
    stopProfilerTimerIfRunning(workInProgress);
  }

  // 标记跳过更新lanes
  markSkippedUpdateLanes(workInProgress.lanes);

  // Check if the children have any pending work.
  if (!includesSomeLane(renderLanes, workInProgress.childLanes)) {
    // The children don't have any work either. We can skip them.
    // TODO: Once we add back resuming, we should check if the children are
    // a work-in-progress set. If so, we need to transfer their effects.
    // children也没有更新工作，直接返回null
    return null;
  } else {
    // This fiber doesn't have work, but its subtree does. Clone the child
    // fibers and continue.
    // children有更新工作，返回child并继续
    // 根据workInProgress的当前child和child.pendingProps创建出新的child
    cloneChildFibers(current, workInProgress);
    return workInProgress.child;
  }
}

function remountFiber(
  current: Fiber,
  oldWorkInProgress: Fiber,
  newWorkInProgress: Fiber,
): Fiber | null {
  if (__DEV__) {
    const returnFiber = oldWorkInProgress.return;
    if (returnFiber === null) {
      throw new Error('Cannot swap the root fiber.');
    }

    // Disconnect from the old current.
    // It will get deleted.
    current.alternate = null;
    oldWorkInProgress.alternate = null;

    // Connect to the new tree.
    newWorkInProgress.index = oldWorkInProgress.index;
    newWorkInProgress.sibling = oldWorkInProgress.sibling;
    newWorkInProgress.return = oldWorkInProgress.return;
    newWorkInProgress.ref = oldWorkInProgress.ref;

    // Replace the child/sibling pointers above it.
    if (oldWorkInProgress === returnFiber.child) {
      returnFiber.child = newWorkInProgress;
    } else {
      let prevSibling = returnFiber.child;
      if (prevSibling === null) {
        throw new Error('Expected parent to have a child.');
      }
      while (prevSibling.sibling !== oldWorkInProgress) {
        prevSibling = prevSibling.sibling;
        if (prevSibling === null) {
          throw new Error('Expected to find the previous sibling.');
        }
      }
      prevSibling.sibling = newWorkInProgress;
    }

    // Delete the old fiber and place the new one.
    // Since the old fiber is disconnected, we have to schedule it manually.
    const last = returnFiber.lastEffect;
    if (last !== null) {
      last.nextEffect = current;
      returnFiber.lastEffect = current;
    } else {
      returnFiber.firstEffect = returnFiber.lastEffect = current;
    }
    current.nextEffect = null;
    current.flags = Deletion;

    newWorkInProgress.flags |= Placement;

    // Restart work from the new fiber.
    return newWorkInProgress;
  } else {
    throw new Error(
      'Did not expect this call in production. ' +
        'This is a bug in React. Please file an issue.',
    );
  }
}

// 开始当前单元工作，返回下一个单元工作
// 这里的核心逻辑是reconcileChildren，也就是dom diff，更新workInProgress.child为下一个单元工作
// 如果是新创建，则没有对应currentFiber child sibling
// 如果是复用，则没有对应sibling
function beginWork(
  current: Fiber | null, // unitOfWork对应的原来的currentFiber
  workInProgress: Fiber, // unitOfWork
  renderLanes: Lanes, // subtreeRenderLanes
): Fiber | null {
  const updateLanes = workInProgress.lanes;

  if (__DEV__) {
    if (workInProgress._debugNeedsRemount && current !== null) {
      // This will restart the begin phase with a new fiber.
      return remountFiber(
        current,
        workInProgress,
        createFiberFromTypeAndProps(
          workInProgress.type,
          workInProgress.key,
          workInProgress.pendingProps,
          workInProgress._debugOwner || null,
          workInProgress.mode,
          workInProgress.lanes,
        ),
      );
    }
  }

  // 拿到didReceiveUpdate标识，是否需要接收更新
  if (current !== null) {
    // 老的props
    // 指向hooks的workInProgressHook链表
    const oldProps = current.memoizedProps;
    // 新的props
    const newProps = workInProgress.pendingProps;

    // oldProps !== newProps 初步对比props context
    // 拿到didReceiveUpdate标识，是否需要接收更新
    if (
      oldProps !== newProps ||
      hasLegacyContextChanged() ||
      // Force a re-render if the implementation changed due to hot reload:
      (__DEV__ ? workInProgress.type !== current.type : false)
    ) {
      // If props or context changed, mark the fiber as having performed work.
      // This may be unset if the props are determined to be equal later (memo).
      // props或者context改变了，标记需要接收更新
      // 如果之后diff发现没有改变，就重新标记为不需要接收更新
      didReceiveUpdate = true;
    } else if (!includesSomeLane(renderLanes, updateLanes)) {
      // renderLanes和updateLanes没有交集
      // 查看children是否有更新工作，有就clone新的children并返回child作为下一个单元工作
      
      // 标记不需要接收更新
      didReceiveUpdate = false;
      // This fiber does not have any pending work. Bailout without entering
      // the begin phase. There's still some bookkeeping we that needs to be done
      // in this optimized path, mostly pushing stuff onto the stack.
      
      // 更新全局指针
      switch (workInProgress.tag) {
        case HostRoot:
          // root
          // 更新didPerformWork rootInstance contextFiber context context指针
          pushHostRootContext(workInProgress);
          resetHydrationState();
          break;
        case HostComponent:
          // 原生dom组件
          // 更新contextFiber和context的指针
          pushHostContext(workInProgress);
          break;
        case ClassComponent: {
          // 类组件
          const Component = workInProgress.type;
          if (isLegacyContextProvider(Component)) {
            // 更新context didPerformWork指针
            pushLegacyContextProvider(workInProgress);
          }
          break;
        }
        case HostPortal:
          // portal组件
          // 更新rootInstance contextFiber context指针
          pushHostContainer(
            workInProgress,
            workInProgress.stateNode.containerInfo,
          );
          break;
        case ContextProvider: {
          // Context.Provider组件
          const newValue = workInProgress.memoizedProps.value;
          // 更新value指针
          pushProvider(workInProgress, newValue);
          break;
        }
        case Profiler:
          // Profiler组件 用于测量渲染一个 React 应用多久渲染一次以及渲染一次的“代价”
          if (enableProfilerTimer) {
            // Profiler should only call onRender when one of its descendants actually rendered.
            // Profiler组件应该在后代组件render时进行计算渲染时间
            const hasChildWork = includesSomeLane(
              renderLanes,
              workInProgress.childLanes,
            );
            // renderLanes和workInProgress.childLanes有交集，说明有后代组件需要render
            // 给Profiler组件加上update副作用
            if (hasChildWork) {
              workInProgress.flags |= Update;
            }

            // Reset effect durations for the next eventual effect phase.
            // These are reset during render to allow the DevTools commit hook a chance to read them,
            // 重置workInProgress.stateNode的effectDuration和passiveEffectDuration
            // 这两个持续时间是给到DevTools来分析性能的，在后面render中会更新这个持续时间
            const stateNode = workInProgress.stateNode;
            stateNode.effectDuration = 0;
            stateNode.passiveEffectDuration = 0;
          }
          break;
        case SuspenseComponent: {
          // suspense组件 懒加载组件
          // 更新suspense组件，更新suspense上下文指针
          const state: SuspenseState | null = workInProgress.memoizedState;
          if (state !== null) {
            if (enableSuspenseServerRenderer) {
              if (state.dehydrated !== null) {
                pushSuspenseContext(
                  workInProgress,
                  setDefaultShallowSuspenseContext(suspenseStackCursor.current),
                );
                // We know that this component will suspend again because if it has
                // been unsuspended it has committed as a resolved Suspense component.
                // If it needs to be retried, it should have work scheduled on it.
                workInProgress.flags |= DidCapture;
                // We should never render the children of a dehydrated boundary until we
                // upgrade it. We return null instead of bailoutOnAlreadyFinishedWork.
                return null;
              }
            }

            // If this boundary is currently timed out, we need to decide
            // whether to retry the primary children, or to skip over it and
            // go straight to the fallback. Check the priority of the primary
            // child fragment.
            const primaryChildFragment: Fiber = (workInProgress.child: any);
            const primaryChildLanes = primaryChildFragment.childLanes;
            if (includesSomeLane(renderLanes, primaryChildLanes)) {
              // The primary children have pending work. Use the normal path
              // to attempt to render the primary children again.
              // primary children有更新工作

              return updateSuspenseComponent(
                current,
                workInProgress,
                renderLanes,
              );
            } else {
              // The primary child fragment does not have pending work marked
              // on it
              // primary children没有更新工作

              pushSuspenseContext(
                workInProgress,
                setDefaultShallowSuspenseContext(suspenseStackCursor.current),
              );
              // The primary children do not have pending work with sufficient
              // priority. Bailout.
              const child = bailoutOnAlreadyFinishedWork(
                current,
                workInProgress,
                renderLanes,
              );
              if (child !== null) {
                // The fallback children have pending work. Skip over the
                // primary children and work on the fallback.
                return child.sibling;
              } else {
                return null;
              }
            }
          } else {
            pushSuspenseContext(
              workInProgress,
              setDefaultShallowSuspenseContext(suspenseStackCursor.current),
            );
          }
          break;
        }
        case SuspenseListComponent: {
          const didSuspendBefore = (current.flags & DidCapture) !== NoFlags;

          const hasChildWork = includesSomeLane(
            renderLanes,
            workInProgress.childLanes,
          );

          if (didSuspendBefore) {
            if (hasChildWork) {
              // If something was in fallback state last time, and we have all the
              // same children then we're still in progressive loading state.
              // Something might get unblocked by state updates or retries in the
              // tree which will affect the tail. So we need to use the normal
              // path to compute the correct tail.
              return updateSuspenseListComponent(
                current,
                workInProgress,
                renderLanes,
              );
            }
            // If none of the children had any work, that means that none of
            // them got retried so they'll still be blocked in the same way
            // as before. We can fast bail out.
            workInProgress.flags |= DidCapture;
          }

          // If nothing suspended before and we're rendering the same children,
          // then the tail doesn't matter. Anything new that suspends will work
          // in the "together" mode, so we can continue from the state we had.
          const renderState = workInProgress.memoizedState;
          if (renderState !== null) {
            // Reset to the "together" mode in case we've started a different
            // update in the past but didn't complete it.
            renderState.rendering = null;
            renderState.tail = null;
            renderState.lastEffect = null;
          }
          pushSuspenseContext(workInProgress, suspenseStackCursor.current);

          if (hasChildWork) {
            break;
          } else {
            // If none of the children had any work, that means that none of
            // them got retried so they'll still be blocked in the same way
            // as before. We can fast bail out.
            return null;
          }
        }
        case OffscreenComponent:
        case LegacyHiddenComponent: {
          // Need to check if the tree still needs to be deferred. This is
          // almost identical to the logic used in the normal update path,
          // so we'll just enter that. The only difference is we'll bail out
          // at the next level instead of this one, because the child props
          // have not changed. Which is fine.
          // TODO: Probably should refactor `beginWork` to split the bailout
          // path from the normal path. I'm tempted to do a labeled break here
          // but I won't :)
          workInProgress.lanes = NoLanes;
          return updateOffscreenComponent(current, workInProgress, renderLanes);
        }
      }
      // workInProgress的children也没有更新工作，就返回null
      // workInProgress的children有更新工作，就clone出新的children并返回workInProgress.child作为下一个单元工作
      return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
    } else {
      if ((current.flags & ForceUpdateForLegacySuspense) !== NoFlags) {
        // This is a special case that only exists for legacy mode.
        // See https://github.com/facebook/react/pull/19216.
        // legacy mode，标记需要接收更新
        didReceiveUpdate = true;
      } else {
        // An update was scheduled on this fiber, but there are no new props
        // nor legacy context. Set this to false. If an update queue or context
        // consumer produces a changed value, it will set this to true. Otherwise,
        // the component will assume the children have not changed and bail out.
        // 虽然有更新调度，但是没有新的props，所以标记不需要接收更新
        // 如果后面发现有props更新了，再标记为需要接收更新
        didReceiveUpdate = false;
      }
    }
  } else {
    // 没有currentFiber，说明是首次渲染
    didReceiveUpdate = false;
  }

  // Before entering the begin phase, clear pending update priority.
  // TODO: This assumes that we're about to evaluate the component and process
  // the update queue. However, there's an exception: SimpleMemoComponent
  // sometimes bails out later in the begin phase. This indicates that we should
  // move this assignment out of the common path and into each branch.

  // 清除workInProgress的更新lanes
  // updateLanes已经存储了这个更新lanes
  workInProgress.lanes = NoLanes;

  switch (workInProgress.tag) {
    case IndeterminateComponent: {
      // 不确定是函数组件还是类组件
      return mountIndeterminateComponent(
        current,
        workInProgress,
        workInProgress.type, // 函数组件的构造函数/类组件的构造器
        renderLanes,
      );
    }
    case LazyComponent: {
      const elementType = workInProgress.elementType;
      return mountLazyComponent(
        current,
        workInProgress,
        elementType,
        updateLanes,
        renderLanes,
      );
    }
    case FunctionComponent: {
      // 函数组件
      // workInProgress的type上存放构造函数
      const Component = workInProgress.type;
      // 未处理的过的新props
      const unresolvedProps = workInProgress.pendingProps;
      // 处理完毕的新props，带defaultProps
      const resolvedProps =
        workInProgress.elementType === Component
          ? unresolvedProps
          : resolveDefaultProps(Component, unresolvedProps);
      return updateFunctionComponent(
        current,
        workInProgress,
        Component,
        resolvedProps,
        renderLanes,
      );
    }
    case ClassComponent: {
      // 类组件
      // workInProgress的type存放组件构造器
      const Component = workInProgress.type;
      // 未处理的新props
      const unresolvedProps = workInProgress.pendingProps;
      // 处理完毕的新props，带defaultProps
      const resolvedProps =
        workInProgress.elementType === Component
          ? unresolvedProps
          // 加上defaultProps
          : resolveDefaultProps(Component, unresolvedProps);
      // 先进行更新类组件前的工作以及调用相关生命周期得到shouldUpdate
      // 然后根据shouldUpdate进行协调children，做dom diff并返回workInProgress.child作为下一个单元任务
      // 这里还会添加ref副作用(如果ref变化)
      return updateClassComponent(
        current,
        workInProgress,
        Component,
        resolvedProps,
        renderLanes,
      );
    }
    case HostRoot:
      // root
      // 核心逻辑reconcileChildren dom diff
      return updateHostRoot(current, workInProgress, renderLanes);
    case HostComponent:
      // 原生dom组件
      // 核心逻辑reconcileChildren dom diff
      return updateHostComponent(current, workInProgress, renderLanes);
    case HostText:
      // 文本组件
      // 不做处理，返回null，表示没有子fiber（文本fiber没有子fiber）
      return updateHostText(current, workInProgress);
    case SuspenseComponent:
      return updateSuspenseComponent(current, workInProgress, renderLanes);
    case HostPortal:
      return updatePortalComponent(current, workInProgress, renderLanes);
    case ForwardRef: {
      const type = workInProgress.type;
      const unresolvedProps = workInProgress.pendingProps;
      const resolvedProps =
        workInProgress.elementType === type
          ? unresolvedProps
          : resolveDefaultProps(type, unresolvedProps);
      return updateForwardRef(
        current,
        workInProgress,
        type,
        resolvedProps,
        renderLanes,
      );
    }
    case Fragment:
      return updateFragment(current, workInProgress, renderLanes);
    case Mode:
      return updateMode(current, workInProgress, renderLanes);
    case Profiler:
      return updateProfiler(current, workInProgress, renderLanes);
    case ContextProvider:
      return updateContextProvider(current, workInProgress, renderLanes);
    case ContextConsumer:
      return updateContextConsumer(current, workInProgress, renderLanes);
    case MemoComponent: {
      // React.memo组件
      // React.memo(Component)

      // workInProgress.type 指向 源Component，也就是函数组件的构造函数
      const type = workInProgress.type;
      // 未处理的新props
      const unresolvedProps = workInProgress.pendingProps;
      // Resolve outer props first, then resolve inner props.
      // 处理React.memo完毕的新props
      let resolvedProps = resolveDefaultProps(type, unresolvedProps);
      if (__DEV__) {
        if (workInProgress.type !== workInProgress.elementType) {
          const outerPropTypes = type.propTypes;
          if (outerPropTypes) {
            checkPropTypes(
              outerPropTypes,
              resolvedProps, // Resolved for outer only
              'prop',
              getComponentName(type),
            );
          }
        }
      }
      // 处理源Component完毕的新props
      resolvedProps = resolveDefaultProps(type.type, resolvedProps);
      // 只有当传入的compare比较新老props和新老ref相同，且源Component对应的workInProgress没有更新，才会返回null，
      // 也就是源Component对应的workInProgress不执行performUnitOfWork => renderWithHooks
      return updateMemoComponent(
        current,
        workInProgress,
        type,
        resolvedProps,
        updateLanes,
        renderLanes,
      );
    }
    case SimpleMemoComponent: {
      return updateSimpleMemoComponent(
        current,
        workInProgress,
        workInProgress.type,
        workInProgress.pendingProps,
        updateLanes,
        renderLanes,
      );
    }
    case IncompleteClassComponent: {
      const Component = workInProgress.type;
      const unresolvedProps = workInProgress.pendingProps;
      const resolvedProps =
        workInProgress.elementType === Component
          ? unresolvedProps
          : resolveDefaultProps(Component, unresolvedProps);
      return mountIncompleteClassComponent(
        current,
        workInProgress,
        Component,
        resolvedProps,
        renderLanes,
      );
    }
    case SuspenseListComponent: {
      return updateSuspenseListComponent(current, workInProgress, renderLanes);
    }
    case FundamentalComponent: {
      if (enableFundamentalAPI) {
        return updateFundamentalComponent(current, workInProgress, renderLanes);
      }
      break;
    }
    case ScopeComponent: {
      if (enableScopeAPI) {
        return updateScopeComponent(current, workInProgress, renderLanes);
      }
      break;
    }
    case Block: {
      if (enableBlocksAPI) {
        const block = workInProgress.type;
        const props = workInProgress.pendingProps;
        return updateBlock(current, workInProgress, block, props, renderLanes);
      }
      break;
    }
    case OffscreenComponent: {
      return updateOffscreenComponent(current, workInProgress, renderLanes);
    }
    case LegacyHiddenComponent: {
      return updateLegacyHiddenComponent(current, workInProgress, renderLanes);
    }
  }
  invariant(
    false,
    'Unknown unit of work tag (%s). This error is likely caused by a bug in ' +
      'React. Please file an issue.',
    workInProgress.tag,
  );
}

export {beginWork};
