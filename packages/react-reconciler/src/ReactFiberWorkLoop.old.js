/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Thenable, Wakeable} from 'shared/ReactTypes';
import type {Fiber, FiberRoot} from './ReactInternalTypes';
import type {Lanes, Lane} from './ReactFiberLane';
import type {ReactPriorityLevel} from './ReactInternalTypes';
import type {Interaction} from 'scheduler/src/Tracing';
import type {SuspenseState} from './ReactFiberSuspenseComponent.old';
import type {Effect as HookEffect} from './ReactFiberHooks.old';
import type {StackCursor} from './ReactFiberStack.old';

import {
  warnAboutDeprecatedLifecycles,
  enableSuspenseServerRenderer,
  replayFailedUnitOfWorkWithInvokeGuardedCallback,
  enableProfilerTimer,
  enableProfilerCommitHooks,
  enableSchedulerTracing,
  warnAboutUnmockedScheduler,
  deferRenderPhaseUpdateToNextBatch,
  decoupleUpdatePriorityFromScheduler,
  enableDebugTracing,
  enableSchedulingProfiler,
  enableScopeAPI,
} from 'shared/ReactFeatureFlags';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import invariant from 'shared/invariant';

import {
  scheduleCallback,
  cancelCallback,
  getCurrentPriorityLevel,
  runWithPriority,
  shouldYield,
  requestPaint,
  now,
  NoPriority as NoSchedulerPriority,
  ImmediatePriority as ImmediateSchedulerPriority,
  UserBlockingPriority as UserBlockingSchedulerPriority,
  NormalPriority as NormalSchedulerPriority,
  flushSyncCallbackQueue,
  scheduleSyncCallback,
} from './SchedulerWithReactIntegration.old';
import {
  logCommitStarted,
  logCommitStopped,
  logLayoutEffectsStarted,
  logLayoutEffectsStopped,
  logPassiveEffectsStarted,
  logPassiveEffectsStopped,
  logRenderStarted,
  logRenderStopped,
} from './DebugTracing';
import {
  markCommitStarted,
  markCommitStopped,
  markLayoutEffectsStarted,
  markLayoutEffectsStopped,
  markPassiveEffectsStarted,
  markPassiveEffectsStopped,
  markRenderStarted,
  markRenderYielded,
  markRenderStopped,
} from './SchedulingProfiler';

// The scheduler is imported here *only* to detect whether it's been mocked
import * as Scheduler from 'scheduler';

import {__interactionsRef, __subscriberRef} from 'scheduler/tracing';

import {
  prepareForCommit,
  resetAfterCommit,
  scheduleTimeout,
  cancelTimeout,
  noTimeout,
  warnsIfNotActing,
  beforeActiveInstanceBlur,
  afterActiveInstanceBlur,
  clearContainer,
} from './ReactFiberHostConfig';

import {
  createWorkInProgress,
  assignFiberPropertiesInDEV,
} from './ReactFiber.old';
import {
  NoMode,
  StrictMode,
  ProfileMode,
  BlockingMode,
  ConcurrentMode,
} from './ReactTypeOfMode';
import {
  HostRoot,
  IndeterminateComponent,
  ClassComponent,
  SuspenseComponent,
  SuspenseListComponent,
  FunctionComponent,
  ForwardRef,
  MemoComponent,
  SimpleMemoComponent,
  Block,
  OffscreenComponent,
  LegacyHiddenComponent,
  ScopeComponent,
} from './ReactWorkTags';
import {LegacyRoot} from './ReactRootTags';
import {
  NoFlags,
  PerformedWork,
  Placement,
  Update,
  PlacementAndUpdate,
  Deletion,
  Ref,
  ContentReset,
  Snapshot,
  Callback,
  Passive,
  PassiveUnmountPendingDev,
  Incomplete,
  HostEffectMask,
  Hydrating,
  HydratingAndUpdate,
} from './ReactFiberFlags';
import {
  NoLanePriority,
  SyncLanePriority,
  SyncBatchedLanePriority,
  InputDiscreteLanePriority,
  DefaultLanePriority,
  NoLanes,
  NoLane,
  SyncLane,
  SyncBatchedLane,
  OffscreenLane,
  NoTimestamp,
  findUpdateLane,
  findTransitionLane,
  findRetryLane,
  includesSomeLane,
  isSubsetOfLanes,
  mergeLanes,
  removeLanes,
  pickArbitraryLane,
  hasDiscreteLanes,
  includesNonIdleWork,
  includesOnlyRetries,
  includesOnlyTransitions,
  getNextLanes,
  returnNextLanesPriority,
  setCurrentUpdateLanePriority,
  getCurrentUpdateLanePriority,
  markStarvedLanesAsExpired,
  getLanesToRetrySynchronouslyOnError,
  getMostRecentEventTime,
  markRootUpdated,
  markRootSuspended as markRootSuspended_dontCallThisOneDirectly,
  markRootPinged,
  markRootExpired,
  markDiscreteUpdatesExpired,
  markRootFinished,
  schedulerPriorityToLanePriority,
  lanePriorityToSchedulerPriority,
} from './ReactFiberLane';
import {requestCurrentTransition, NoTransition} from './ReactFiberTransition';
import {beginWork as originalBeginWork} from './ReactFiberBeginWork.old';
import {completeWork} from './ReactFiberCompleteWork.old';
import {unwindWork, unwindInterruptedWork} from './ReactFiberUnwindWork.old';
import {
  throwException,
  createRootErrorUpdate,
  createClassErrorUpdate,
} from './ReactFiberThrow.old';
import {
  commitBeforeMutationLifeCycles as commitBeforeMutationEffectOnFiber,
  commitLifeCycles as commitLayoutEffectOnFiber,
  commitPlacement,
  commitWork,
  commitDeletion,
  commitDetachRef,
  commitAttachRef,
  commitPassiveEffectDurations,
  commitResetTextContent,
  isSuspenseBoundaryBeingHidden,
} from './ReactFiberCommitWork.old';
import {enqueueUpdate} from './ReactUpdateQueue.old';
import {resetContextDependencies} from './ReactFiberNewContext.old';
import {
  resetHooksAfterThrow,
  ContextOnlyDispatcher,
  getIsUpdatingOpaqueValueInRenderPhaseInDEV,
} from './ReactFiberHooks.old';
import {createCapturedValue} from './ReactCapturedValue';
import {
  push as pushToStack,
  pop as popFromStack,
  createCursor,
} from './ReactFiberStack.old';

import {
  recordCommitTime,
  recordPassiveEffectDuration,
  startPassiveEffectTimer,
  startProfilerTimer,
  stopProfilerTimerIfRunningAndRecordDelta,
} from './ReactProfilerTimer.old';

// DEV stuff
import getComponentName from 'shared/getComponentName';
import ReactStrictModeWarnings from './ReactStrictModeWarnings.old';
import {
  isRendering as ReactCurrentDebugFiberIsRenderingInDEV,
  current as ReactCurrentFiberCurrent,
  resetCurrentFiber as resetCurrentDebugFiberInDEV,
  setCurrentFiber as setCurrentDebugFiberInDEV,
} from './ReactCurrentFiber';
import {
  invokeGuardedCallback,
  hasCaughtError,
  clearCaughtError,
} from 'shared/ReactErrorUtils';
import {onCommitRoot as onCommitRootDevTools} from './ReactFiberDevToolsHook.old';
import {onCommitRoot as onCommitRootTestSelector} from './ReactTestSelectors';

// Used by `act`
import enqueueTask from 'shared/enqueueTask';
import {doesFiberContain} from './ReactFiberTreeReflection';

const ceil = Math.ceil;

const {
  ReactCurrentDispatcher,
  ReactCurrentOwner,
  IsSomeRendererActing,
} = ReactSharedInternals;

type ExecutionContext = number;

export const NoContext = /*             */ 0b0000000;
const BatchedContext = /*               */ 0b0000001;
const EventContext = /*                 */ 0b0000010;
const DiscreteEventContext = /*         */ 0b0000100;
const LegacyUnbatchedContext = /*       */ 0b0001000;
const RenderContext = /*                */ 0b0010000;
const CommitContext = /*                */ 0b0100000;
export const RetryAfterError = /*       */ 0b1000000;

type RootExitStatus = 0 | 1 | 2 | 3 | 4 | 5;
const RootIncomplete = 0;
const RootFatalErrored = 1;
const RootErrored = 2;
const RootSuspended = 3;
const RootSuspendedWithDelay = 4;
const RootCompleted = 5;

// Describes where we are in the React execution stack
let executionContext: ExecutionContext = NoContext;
// The root we're working on
let workInProgressRoot: FiberRoot | null = null;
// The fiber we're working on
let workInProgress: Fiber | null = null;
// The lanes we're rendering
let workInProgressRootRenderLanes: Lanes = NoLanes;

// Stack that allows components to change the render lanes for its subtree
// This is a superset of the lanes we started working on at the root. The only
// case where it's different from `workInProgressRootRenderLanes` is when we
// enter a subtree that is hidden and needs to be unhidden: Suspense and
// Offscreen component.
//
// Most things in the work loop should deal with workInProgressRootRenderLanes.
// Most things in begin/complete phases should deal with subtreeRenderLanes.
let subtreeRenderLanes: Lanes = NoLanes;
const subtreeRenderLanesCursor: StackCursor<Lanes> = createCursor(NoLanes);

// Whether to root completed, errored, suspended, etc.
let workInProgressRootExitStatus: RootExitStatus = RootIncomplete;
// A fatal error, if one is thrown
let workInProgressRootFatalError: mixed = null;
// "Included" lanes refer to lanes that were worked on during this render. It's
// slightly different than `renderLanes` because `renderLanes` can change as you
// enter and exit an Offscreen tree. This value is the combination of all render
// lanes for the entire render phase.
let workInProgressRootIncludedLanes: Lanes = NoLanes;
// The work left over by components that were visited during this render. Only
// includes unprocessed updates, not work in bailed out children.
let workInProgressRootSkippedLanes: Lanes = NoLanes;
// Lanes that were updated (in an interleaved event) during this render.
let workInProgressRootUpdatedLanes: Lanes = NoLanes;
// Lanes that were pinged (in an interleaved event) during this render.
let workInProgressRootPingedLanes: Lanes = NoLanes;

let mostRecentlyUpdatedRoot: FiberRoot | null = null;

// The most recent time we committed a fallback. This lets us ensure a train
// model where we don't commit new loading states in too quick succession.
let globalMostRecentFallbackTime: number = 0;
const FALLBACK_THROTTLE_MS: number = 500;

// The absolute time for when we should start giving up on rendering
// more and prefer CPU suspense heuristics instead.
let workInProgressRootRenderTargetTime: number = Infinity;
// How long a render is supposed to take before we start following CPU
// suspense heuristics and opt out of rendering more content.
const RENDER_TIMEOUT_MS = 500;

function resetRenderTimer() {
  workInProgressRootRenderTargetTime = now() + RENDER_TIMEOUT_MS;
}

export function getRenderTargetTime(): number {
  return workInProgressRootRenderTargetTime;
}

let nextEffect: Fiber | null = null;
let hasUncaughtError = false;
let firstUncaughtError = null;
let legacyErrorBoundariesThatAlreadyFailed: Set<mixed> | null = null;

let rootDoesHavePassiveEffects: boolean = false;
let rootWithPendingPassiveEffects: FiberRoot | null = null;
let pendingPassiveEffectsRenderPriority: ReactPriorityLevel = NoSchedulerPriority;
let pendingPassiveEffectsLanes: Lanes = NoLanes;
let pendingPassiveHookEffectsMount: Array<HookEffect | Fiber> = [];
let pendingPassiveHookEffectsUnmount: Array<HookEffect | Fiber> = [];
let pendingPassiveProfilerEffects: Array<Fiber> = [];

let rootsWithPendingDiscreteUpdates: Set<FiberRoot> | null = null;

// Use these to prevent an infinite loop of nested updates
const NESTED_UPDATE_LIMIT = 50;
let nestedUpdateCount: number = 0;
let rootWithNestedUpdates: FiberRoot | null = null;

const NESTED_PASSIVE_UPDATE_LIMIT = 50;
let nestedPassiveUpdateCount: number = 0;

// Marks the need to reschedule pending interactions at these lanes
// during the commit phase. This enables them to be traced across components
// that spawn new work during render. E.g. hidden boundaries, suspended SSR
// hydration or SuspenseList.
// TODO: Can use a bitmask instead of an array
let spawnedWorkDuringRender: null | Array<Lane | Lanes> = null;

// If two updates are scheduled within the same event, we should treat their
// event times as simultaneous, even if the actual clock time has advanced
// between the first and second call.
let currentEventTime: number = NoTimestamp;
let currentEventWipLanes: Lanes = NoLanes;
let currentEventPendingLanes: Lanes = NoLanes;

// Dev only flag that tracks if passive effects are currently being flushed.
// We warn about state updates for unmounted components differently in this case.
let isFlushingPassiveEffects = false;

let focusedInstanceHandle: null | Fiber = null;
let shouldFireAfterActiveInstanceBlur: boolean = false;

export function getWorkInProgressRoot(): FiberRoot | null {
  return workInProgressRoot;
}

export function requestEventTime() {
  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    // We're inside React, so it's fine to read the actual time.
    return now();
  }
  // We're not inside React, so we may be in the middle of a browser event.
  if (currentEventTime !== NoTimestamp) {
    // Use the same start time for all updates until we enter React again.
    return currentEventTime;
  }
  // This is the first update since React yielded. Compute a new start time.
  currentEventTime = now();
  return currentEventTime;
}

export function getCurrentTime() {
  return now();
}

// 泳道的优先级计算基于fiber.mode属性值分为以下几类：
//   1. SyncLane同步泳道 也就是普通泳道
//   2. 在并发模式下的同步泳道
//   3. 在并发模型下的批量泳道
// 旧模式中lane只为SyncLane = 1
export function requestUpdateLane(fiber: Fiber): Lane {
  // Special cases
  const mode = fiber.mode;
  if ((mode & BlockingMode) === NoMode) {
    // 非BlockingMode 0b00010
    return (SyncLane: Lane); // 0b0000000000000000000000000000001
  } else if ((mode & ConcurrentMode) === NoMode) {
    // 非ConcurrentMode 0b00100，也就是这边只有BlockingMode
    return getCurrentPriorityLevel() === ImmediateSchedulerPriority
      ? (SyncLane: Lane) // 0b0000000000000000000000000000001
      : (SyncBatchedLane: Lane); // 0b0000000000000000000000000000010
  } else if (
    // 上面两种已经包含所有情况，这里是什么???
    !deferRenderPhaseUpdateToNextBatch &&
    (executionContext & RenderContext) !== NoContext &&
    workInProgressRootRenderLanes !== NoLanes
  ) {
    // This is a render phase update. These are not officially supported. The
    // old behavior is to give this the same "thread" (expiration time) as
    // whatever is currently rendering. So if you call `setState` on a component
    // that happens later in the same render, it will flush. Ideally, we want to
    // remove the special case and treat them as if they came from an
    // interleaved event. Regardless, this pattern is not officially supported.
    // This behavior is only a fallback. The flag only exists until we can roll
    // out the setState warning, since existing code might accidentally rely on
    // the current behavior.
    return pickArbitraryLane(workInProgressRootRenderLanes);
  }

  // The algorithm for assigning an update to a lane should be stable for all
  // updates at the same priority within the same event. To do this, the inputs
  // to the algorithm must be the same. For example, we use the `renderLanes`
  // to avoid choosing a lane that is already in the middle of rendering.
  //
  // However, the "included" lanes could be mutated in between updates in the
  // same event, like if you perform an update inside `flushSync`. Or any other
  // code path that might call `prepareFreshStack`.
  //
  // The trick we use is to cache the first of each of these inputs within an
  // event. Then reset the cached values once we can be sure the event is over.
  // Our heuristic for that is whenever we enter a concurrent work loop.
  //
  // We'll do the same for `currentEventPendingLanes` below.
  if (currentEventWipLanes === NoLanes) {
    currentEventWipLanes = workInProgressRootIncludedLanes;
  }

  const isTransition = requestCurrentTransition() !== NoTransition;
  if (isTransition) {
    if (currentEventPendingLanes !== NoLanes) {
      currentEventPendingLanes =
        mostRecentlyUpdatedRoot !== null
          ? mostRecentlyUpdatedRoot.pendingLanes
          : NoLanes;
    }
    return findTransitionLane(currentEventWipLanes, currentEventPendingLanes);
  }

  // TODO: Remove this dependency on the Scheduler priority.
  // To do that, we're replacing it with an update lane priority.
  const schedulerPriority = getCurrentPriorityLevel();

  // The old behavior was using the priority level of the Scheduler.
  // This couples React to the Scheduler internals, so we're replacing it
  // with the currentUpdateLanePriority above. As an example of how this
  // could be problematic, if we're not inside `Scheduler.runWithPriority`,
  // then we'll get the priority of the current running Scheduler task,
  // which is probably not what we want.
  let lane;
  if (
    // TODO: Temporary. We're removing the concept of discrete updates.
    (executionContext & DiscreteEventContext) !== NoContext &&
    schedulerPriority === UserBlockingSchedulerPriority
  ) {
    lane = findUpdateLane(InputDiscreteLanePriority, currentEventWipLanes);
  } else {
    const schedulerLanePriority = schedulerPriorityToLanePriority(
      schedulerPriority,
    );

    if (decoupleUpdatePriorityFromScheduler) {
      // In the new strategy, we will track the current update lane priority
      // inside React and use that priority to select a lane for this update.
      // For now, we're just logging when they're different so we can assess.
      const currentUpdateLanePriority = getCurrentUpdateLanePriority();

      if (
        schedulerLanePriority !== currentUpdateLanePriority &&
        currentUpdateLanePriority !== NoLanePriority
      ) {
        if (__DEV__) {
          console.error(
            'Expected current scheduler lane priority %s to match current update lane priority %s',
            schedulerLanePriority,
            currentUpdateLanePriority,
          );
        }
      }
    }

    lane = findUpdateLane(schedulerLanePriority, currentEventWipLanes);
  }

  return lane;
}

function requestRetryLane(fiber: Fiber) {
  // This is a fork of `requestUpdateLane` designed specifically for Suspense
  // "retries" — a special update that attempts to flip a Suspense boundary
  // from its placeholder state to its primary/resolved state.

  // Special cases
  const mode = fiber.mode;
  if ((mode & BlockingMode) === NoMode) {
    return (SyncLane: Lane);
  } else if ((mode & ConcurrentMode) === NoMode) {
    return getCurrentPriorityLevel() === ImmediateSchedulerPriority
      ? (SyncLane: Lane)
      : (SyncBatchedLane: Lane);
  }

  // See `requestUpdateLane` for explanation of `currentEventWipLanes`
  if (currentEventWipLanes === NoLanes) {
    currentEventWipLanes = workInProgressRootIncludedLanes;
  }
  return findRetryLane(currentEventWipLanes);
}

// fiber里的调度更新
// 内部核心逻辑都是performSyncWorkOnRoot
// performSyncWorkOnRoot 先执行同步工作renderRootSync，然后提交root
// 将performSyncWorkOnRoot作为callback推入内部同步队列syncQueue
// 如果这个callback是第一个，将flushSyncCallbackQueueImpl作为callback设置immediateQueueCallbackNode，直接在next tick调度它
// 执行流程是flushWork => flushSyncCallbackQueueImpl => performSyncWorkOnRoot
export function scheduleUpdateOnFiber(
  fiber: Fiber, // currentFiber
  lane: Lane, // 泳道，旧模式中lane只为SyncLane = 1
  eventTime: number, // 程序运行到此刻的时间戳，React会基于它进行更新优先级排序
) {
  // 检查update tasks的数量是否超过50个
  checkForNestedUpdates();
  warnAboutRenderPhaseUpdatesInDEV(fiber);

  // 当前fiber向上遍历找到rootFiber对应的fiberRoot，同时更新childLanes
  const root = markUpdateLaneFromFiberToRoot(fiber, lane);
  // root不存在，直接返回null
  if (root === null) {
    warnAboutUpdateOnUnmountedFiberInDEV(fiber);
    return null;
  }

  // Mark that the root has a pending update.
  // 将当前fiberRoot标记为挂起更新状态
  markRootUpdated(root, lane, eventTime);

  if (root === workInProgressRoot) {
    // Received an update to a tree that's in the middle of rendering. Mark
    // that there was an interleaved update work on this root. Unless the
    // `deferRenderPhaseUpdateToNextBatch` flag is off and this is a render
    // phase update. In that case, we don't treat render phase updates as if
    // they were interleaved, for backwards compat reasons.
    // 当在执行渲染的时候接收到一个update对象到tree中
    if (
      deferRenderPhaseUpdateToNextBatch ||
      (executionContext & RenderContext) === NoContext
    ) {
      // 将新传入的lane对象合并到正在执行的Lanes队列中
      workInProgressRootUpdatedLanes = mergeLanes(
        workInProgressRootUpdatedLanes,
        lane,
      );
    }
    // 如果当前fiber的root已经被延迟挂起也就是说渲染这一步必然没有完成。
    // 所以需要在更新之前，对fiber标注suspended，否则就会导致渲染中断，再次触发fiber更新
    if (workInProgressRootExitStatus === RootSuspendedWithDelay) {
      // The root already suspended with a delay, which means this render
      // definitely won't finish. Since we have a new update, let's mark it as
      // suspended now, right before marking the incoming update. This has the
      // effect of interrupting the current render and switching to the update.
      // TODO: Make sure this doesn't override pings that happen while we've
      // already started rendering.
      markRootSuspended(root, workInProgressRootRenderLanes);
    }
  }

  // TODO: requestUpdateLanePriority also reads the priority. Pass the
  // priority as an argument to that function and this one.
  // 获取当前fiber的优先级
  const priorityLevel = getCurrentPriorityLevel();

  // 所有情况下内部核心逻辑都是performSyncWorkOnRoot
  // performSyncWorkOnRoot 先执行同步工作renderRootSync，然后提交root
  // 大部分情况下都是lane都是同步泳道
  if (lane === SyncLane) {
    if (
      // Check if we're inside unbatchedUpdates
      (executionContext & LegacyUnbatchedContext) !== NoContext &&
      // Check if we're not already rendering
      (executionContext & (RenderContext | CommitContext)) === NoContext
    ) {
      // Register pending interactions on the root to avoid losing traced interaction data.
      // 这个函数用于防止交互数据丢失
      schedulePendingInteractions(root, lane);

      // This is a legacy edge case. The initial mount of a ReactDOM.render-ed
      // root inside of batchedUpdates should be synchronous, but layout updates
      // should be deferred until the end of the batch.
      // 这是一个遗留的边缘情况
      // 从Root开始执行同步工作，完成之后提交
      performSyncWorkOnRoot(root);
    } else {
      // fiberRoot获取到新的callback优先级和callbackNode
      // 如果旧的优先级existingCallbackPriority和newCallbackPriority相同，就不重新获取，直接返回
      // 将performSyncWorkOnRoot作为callback推入内部同步队列syncQueue
      // 如果这个callback是第一个，将flushSyncCallbackQueueImpl作为callback设置immediateQueueCallbackNode，直接在next tick调度它
      // 执行流程是flushWork => flushSyncCallbackQueueImpl => performSyncWorkOnRoot
      ensureRootIsScheduled(root, eventTime);
      // ???
      schedulePendingInteractions(root, lane);
      if (executionContext === NoContext) {
        // Flush the synchronous work now, unless we're already working or inside
        // a batch. This is intentionally inside scheduleUpdateOnFiber instead of
        // scheduleCallbackForFiber to preserve the ability to schedule a callback
        // without immediately flushing it. We only do this for user-initiated
        // updates, to preserve historical behavior of legacy mode.
        resetRenderTimer();
        // 移除immediateQueueCallbackNode，开始同步回调队列syncQueue，遍历执行队列中的每一个回调
        // 根据decoupleUpdatePriorityFromScheduler分为带最新优先级和不带最新优先级两种
        flushSyncCallbackQueue();
      }
    }
  } else {
    // Schedule a discrete update but only if it's not Sync.
    // 少数情况下，我们进行离散更新
    if (
      (executionContext & DiscreteEventContext) !== NoContext &&
      // Only updates at user-blocking priority or greater are considered
      // discrete, even inside a discrete event.
      // 优先级必须达到用户阻塞优先级及以上
      (priorityLevel === UserBlockingSchedulerPriority ||
        priorityLevel === ImmediateSchedulerPriority)
    ) {
      // This is the result of a discrete event. Track the lowest priority
      // discrete update per root so we can flush them early, if needed.
      // rootsWithPendingDiscreteUpdates中添加fiberRoot
      if (rootsWithPendingDiscreteUpdates === null) {
        rootsWithPendingDiscreteUpdates = new Set([root]);
      } else {
        rootsWithPendingDiscreteUpdates.add(root);
      }
    }
    // Schedule other updates after in case the callback is sync.
    // 如果callback是同步的，就调度其他更新???

    // fiberRoot获取到新的callback优先级和callbackNode
    // 内部会调用performSyncWorkOnRoot(root)
    ensureRootIsScheduled(root, eventTime);
    // ???
    schedulePendingInteractions(root, lane);
  }

  // We use this when assigning a lane for a transition inside
  // `requestUpdateLane`. We assume it's the same as the root being updated,
  // since in the common case of a single root app it probably is. If it's not
  // the same root, then it's not a huge deal, we just might batch more stuff
  // together more than necessary.
  // 更新最近的一个fiberRoot
  mostRecentlyUpdatedRoot = root;
}

// This is split into a separate function so we can mark a fiber with pending
// work without treating it as a typical update that originates from an event;
// e.g. retrying a Suspense boundary isn't an update, but it does schedule work
// on a fiber.
// 当前Fiber向上遍历找到rootFiber对应的fiberRoot，同时更新childLanes
function markUpdateLaneFromFiberToRoot(
  sourceFiber: Fiber, // currentFiber
  lane: Lane,
): FiberRoot | null {
  // Update the source fiber's lanes
  sourceFiber.lanes = mergeLanes(sourceFiber.lanes, lane);
  let alternate = sourceFiber.alternate;
  if (alternate !== null) {
    alternate.lanes = mergeLanes(alternate.lanes, lane);
  }
  if (__DEV__) {
    if (
      alternate === null &&
      (sourceFiber.flags & (Placement | Hydrating)) !== NoFlags
    ) {
      warnAboutUpdateOnNotYetMountedFiberInDEV(sourceFiber);
    }
  }
  // Walk the parent path to the root and update the child expiration time.
  // 遍历父节点到根，更新其childLanes
  let node = sourceFiber;
  let parent = sourceFiber.return;
  while (parent !== null) {
    parent.childLanes = mergeLanes(parent.childLanes, lane);
    alternate = parent.alternate;
    if (alternate !== null) {
      alternate.childLanes = mergeLanes(alternate.childLanes, lane);
    } else {
      if (__DEV__) {
        if ((parent.flags & (Placement | Hydrating)) !== NoFlags) {
          warnAboutUpdateOnNotYetMountedFiberInDEV(sourceFiber);
        }
      }
    }
    node = parent;
    parent = parent.return;
  }
  // 这里的node为根rootFiber
  if (node.tag === HostRoot) {
    const root: FiberRoot = node.stateNode; // 获取fiberRoot
    return root;
  } else {
    return null;
  }
}

// Use this function to schedule a task for a root. There's only one task per
// root; if a task was already scheduled, we'll check to make sure the priority
// of the existing task is the same as the priority of the next level that the
// root has work on. This function is called on every update, and right before
// exiting a task.
// 这个函数用于实现根任务的调度，这个函数中只有一个针对root的task
// 如果task已经被调度，将确保这个task的优先级与root task相同
// 该函数在每次fiber更新的时候都会被调用

// fiberRoot获取到新的callback优先级和callbackNode
// 如果旧的优先级existingCallbackPriority和newCallbackPriority相同，就不重新获取，直接返回
// 将performSyncWorkOnRoot作为callback推入内部同步队列syncQueue
// 如果这个callback是第一个，将flushSyncCallbackQueueImpl作为callback设置immediateQueueCallbackNode，直接在next tick调度它
// 哪里设置了next tick的调度逻辑???
// 执行流程是flushWork => flushSyncCallbackQueueImpl => performSyncWorkOnRoot/performConcurrentWorkOnRoot
function ensureRootIsScheduled(root: FiberRoot, currentTime: number) {
  // 在当前fiberRoot中获取callbackNode
  const existingCallbackNode = root.callbackNode;

  // Check if any lanes are being starved by other work. If so, mark them as
  // expired so we know to work on those next.
  // 检查root.pendingLanes中的每一个lane
  // 如果没有过期时间，根据程序运行到此刻的时间戳currentTime重新计算过期时间
  // 如果过期了，添加这个lane到root.expiredLanes中
  markStarvedLanesAsExpired(root, currentTime);

  // Determine the next lanes to work on, and their priority.
  // 计算出下一个泳道nextLanes
  // 这里可能会将当前正在渲染的wipLanes中断，切换到nextLanes，异步渲染???
  const nextLanes = getNextLanes(
    root,
    root === workInProgressRoot ? workInProgressRootRenderLanes : NoLanes,
  );
  // This returns the priority level computed during the `getNextLanes` call.
  // 计算出下一个泳道的优先级
  const newCallbackPriority = returnNextLanesPriority();

  // 如果下一个泳道为空，也就是下面没有渲染任务
  if (nextLanes === NoLanes) {
    // Special case: There's nothing to work on.
    // 但其存在优先级
    if (existingCallbackNode !== null) {
      cancelCallback(existingCallbackNode);
      // 将该优先级的回调删除
      root.callbackNode = null;
      root.callbackPriority = NoLanePriority;
    }
    return;
  }

  // Check if there's an existing task. We may be able to reuse it.
  // existingCallbackNode还存在
  if (existingCallbackNode !== null) {
    const existingCallbackPriority = root.callbackPriority;
    // 旧的和新的优先级相同，直接旧的回调
    if (existingCallbackPriority === newCallbackPriority) {
      // The priority hasn't changed. We can reuse the existing task. Exit.
      return;
    }
    // The priority changed. Cancel the existing callback. We'll schedule a new
    // one below.
    // 改变优先级，取消当前existingCallbackNode，调度一个新的
    cancelCallback(existingCallbackNode);
  }

  // Schedule a new callback.
  // 调度一个新的回调函数
  // performSyncWorkOnRoot 同步任务
  // performConcurrentWorkOnRoot 异步任务，可以打断，每次调用都要查看是否超时
  let newCallbackNode;
  if (newCallbackPriority === SyncLanePriority) {
    // Special case: Sync React callbacks are scheduled on a special
    // internal queue
    // 同步优先级
    // 将 performSyncWorkOnRoot 作为callback推入内部同步队列syncQueue
    // 如果callback是第一个，将flushSyncCallbackQueueImpl作为callback设置immediateQueueCallbackNode，直接在next tick调度它
    // 哪里设置了next tick的调度逻辑???
    // 返回fakeCallbackNode，这个有什么用
    // 这个方法只会设置scheduledCallback和scheduledTimeout，而不会立即执行flushWork
    // flushWork函数是作为scheduledCallback执行，其核心逻辑是workLoop
    // workLoop是fiber架构异步更新的原理
    // 执行流程是flushWork => flushSyncCallbackQueueImpl => performSyncWorkOnRoot
    newCallbackNode = scheduleSyncCallback(
      performSyncWorkOnRoot.bind(null, root),
    );
  } else if (newCallbackPriority === SyncBatchedLanePriority) {
    // 同步批量优先级
    // 根据优先级调度callback
    newCallbackNode = scheduleCallback(
      ImmediateSchedulerPriority,
      performSyncWorkOnRoot.bind(null, root),
    );
  } else {
    // 其他优先级
    const schedulerPriorityLevel = lanePriorityToSchedulerPriority(
      newCallbackPriority,
    );
    // 根据优先级调度performConcurrentWorkOnRoot，返回newTask，这个newTask会被推入taskQueue/timerQueue
    // 返回的newTask的callback就是传入的performConcurrentWorkOnRoot
    newCallbackNode = scheduleCallback(
      schedulerPriorityLevel,
      performConcurrentWorkOnRoot.bind(null, root),
    );
  }

  // 当前fiberRoot获取到新的callback优先级和callbackNode
  root.callbackPriority = newCallbackPriority;
  root.callbackNode = newCallbackNode;
}

// This is the entry point for every concurrent task, i.e. anything that
// goes through Scheduler.
// 异步任务，可以打断，每次调用都要查看是否超时
// performConcurrentWorkOnRoot是newTask的callback，会被推入taskQueue/timerQueue
// performConcurrentWorkOnRoot继续返回performConcurrentWorkOnRoot的话，会进入异步更新循环
// 如果返回null，就结束异步更新循环
function performConcurrentWorkOnRoot(root) {
  // Since we know we're in a React event, we can clear the current
  // event time. The next update will compute a new event time.
  currentEventTime = NoTimestamp;
  currentEventWipLanes = NoLanes;
  currentEventPendingLanes = NoLanes;

  invariant(
    (executionContext & (RenderContext | CommitContext)) === NoContext,
    'Should not already be working.',
  );

  // Flush any pending passive effects before deciding which lanes to work on,
  // in case they schedule additional work.
  const originalCallbackNode = root.callbackNode;
  // 如果有passive副作用，这步操作将在flushPassiveEffects中执行
  const didFlushPassiveEffects = flushPassiveEffects();
  if (didFlushPassiveEffects) {
    // Something in the passive effect phase may have canceled the current task.
    // Check if the task node for this root was changed.
    if (root.callbackNode !== originalCallbackNode) {
      // The current task was canceled. Exit. We don't need to call
      // `ensureRootIsScheduled` because the check above implies either that
      // there's a new task, or that there's no remaining work on this root.
      return null;
    } else {
      // Current task was not canceled. Continue.
    }
  }

  // Determine the next expiration time to work on, using the fields stored
  // on the root.
  // 计算出下一个泳道nextLanes
  // 这里可能会将当前正在渲染的wipLanes中断，切换到nextLanes，异步渲染???
  let lanes = getNextLanes(
    root,
    root === workInProgressRoot ? workInProgressRootRenderLanes : NoLanes,
  );
  // 如果下一个泳道为空，也就是下面没有渲染任务，直接返回null
  if (lanes === NoLanes) {
    // Defensive coding. This is never expected to happen.
    return null;
  }

  // renderRootSync的异步版本，可中断
  // 核心逻辑workLoopConcurrent，每个循环（也就是更新每一个workInProgress）都会判断是否需要移交控制权给浏览器，以此实现时间切片
  // 中断后返回 RootIncomplete
  // 没有中断直接返回 workInProgressRootExitStatus
  let exitStatus = renderRootConcurrent(root, lanes);

  if (
    includesSomeLane(
      workInProgressRootIncludedLanes,
      workInProgressRootUpdatedLanes,
    )
  ) {
    // The render included lanes that were updated during the render phase.
    // For example, when unhiding a hidden tree, we include all the lanes
    // that were previously skipped when the tree was hidden. That set of
    // lanes is a superset of the lanes we started rendering with.
    //
    // So we'll throw out the current work and restart.
    prepareFreshStack(root, NoLanes);
  } else if (exitStatus !== RootIncomplete) {
    // 没有异步中断

    if (exitStatus === RootErrored) {
      // 出错
      executionContext |= RetryAfterError;

      // If an error occurred during hydration,
      // discard server response and fall back to client side render.
      if (root.hydrate) {
        root.hydrate = false;
        clearContainer(root.containerInfo);
      }

      // If something threw an error, try rendering one more time. We'll render
      // synchronously to block concurrent data mutations, and we'll includes
      // all pending updates are included. If it still fails after the second
      // attempt, we'll give up and commit the resulting tree.
      lanes = getLanesToRetrySynchronouslyOnError(root);
      if (lanes !== NoLanes) {
        exitStatus = renderRootSync(root, lanes);
      }
    }

    if (exitStatus === RootFatalErrored) {
      const fatalError = workInProgressRootFatalError;
      prepareFreshStack(root, NoLanes);
      markRootSuspended(root, lanes);
      ensureRootIsScheduled(root, now());
      throw fatalError;
    }

    // We now have a consistent tree. The next step is either to commit it,
    // or, if something suspended, wait to commit it after a timeout.
    // 走到这里，说明已经完成了整个fiber树的render，下面就是提交
    const finishedWork: Fiber = (root.current.alternate: any);
    root.finishedWork = finishedWork;
    root.finishedLanes = lanes;
    // 提交
    finishConcurrentRender(root, exitStatus, lanes);
  }

  // 计算下一批lanes的优先级情况
  ensureRootIsScheduled(root, now());
  // performConcurrentWorkOnRoot是newTask的callback，会被推入taskQueue/timerQueue
  // performConcurrentWorkOnRoot继续返回performConcurrentWorkOnRoot的话，会进入异步更新循环
  // 如果返回null，就结束异步更新循环
  if (root.callbackNode === originalCallbackNode) {
    // The task node scheduled for this root is the same one that's
    // currently executed. Need to return a continuation.
    // 更新过程中断，需要返回performConcurrentWorkOnRoot函数，workLoop中就不会将performConcurrentWorkOnRoot对应的newTask移除，就可以实现时间分片异步更新了
    return performConcurrentWorkOnRoot.bind(null, root);
  }
  return null;
}

// 整个fiber树完成更新，进行提交
function finishConcurrentRender(root, exitStatus, lanes) {
  switch (exitStatus) {
    case RootIncomplete:
    case RootFatalErrored: {
      invariant(false, 'Root did not complete. This is a bug in React.');
    }
    // Flow knows about invariant, so it complains if I add a break
    // statement, but eslint doesn't know about invariant, so it complains
    // if I do. eslint-disable-next-line no-fallthrough
    case RootErrored: {
      // We should have already attempted to retry this tree. If we reached
      // this point, it errored again. Commit it.
      commitRoot(root);
      break;
    }
    case RootSuspended: {
      markRootSuspended(root, lanes);

      // We have an acceptable loading state. We need to figure out if we
      // should immediately commit it or wait a bit.

      if (
        includesOnlyRetries(lanes) &&
        // do not delay if we're inside an act() scope
        !shouldForceFlushFallbacksInDEV()
      ) {
        // This render only included retries, no updates. Throttle committing
        // retries so that we don't show too many loading states too quickly.
        const msUntilTimeout =
          globalMostRecentFallbackTime + FALLBACK_THROTTLE_MS - now();
        // Don't bother with a very short suspense time.
        if (msUntilTimeout > 10) {
          const nextLanes = getNextLanes(root, NoLanes);
          if (nextLanes !== NoLanes) {
            // There's additional work on this root.
            break;
          }
          const suspendedLanes = root.suspendedLanes;
          if (!isSubsetOfLanes(suspendedLanes, lanes)) {
            // We should prefer to render the fallback of at the last
            // suspended level. Ping the last suspended level to try
            // rendering it again.
            // FIXME: What if the suspended lanes are Idle? Should not restart.
            const eventTime = requestEventTime();
            markRootPinged(root, suspendedLanes, eventTime);
            break;
          }

          // The render is suspended, it hasn't timed out, and there's no
          // lower priority work to do. Instead of committing the fallback
          // immediately, wait for more data to arrive.
          root.timeoutHandle = scheduleTimeout(
            commitRoot.bind(null, root),
            msUntilTimeout,
          );
          break;
        }
      }
      // The work expired. Commit immediately.
      commitRoot(root);
      break;
    }
    case RootSuspendedWithDelay: {
      markRootSuspended(root, lanes);

      if (includesOnlyTransitions(lanes)) {
        // This is a transition, so we should exit without committing a
        // placeholder and without scheduling a timeout. Delay indefinitely
        // until we receive more data.
        break;
      }

      if (!shouldForceFlushFallbacksInDEV()) {
        // This is not a transition, but we did trigger an avoided state.
        // Schedule a placeholder to display after a short delay, using the Just
        // Noticeable Difference.
        // TODO: Is the JND optimization worth the added complexity? If this is
        // the only reason we track the event time, then probably not.
        // Consider removing.

        const mostRecentEventTime = getMostRecentEventTime(root, lanes);
        const eventTimeMs = mostRecentEventTime;
        const timeElapsedMs = now() - eventTimeMs;
        const msUntilTimeout = jnd(timeElapsedMs) - timeElapsedMs;

        // Don't bother with a very short suspense time.
        if (msUntilTimeout > 10) {
          // Instead of committing the fallback immediately, wait for more data
          // to arrive.
          root.timeoutHandle = scheduleTimeout(
            commitRoot.bind(null, root),
            msUntilTimeout,
          );
          break;
        }
      }

      // Commit the placeholder.
      commitRoot(root);
      break;
    }
    case RootCompleted: {
      // The work completed. Ready to commit.
      // 提交fiberRoot
      // 这里会走三个阶段before mutation  mutation  layout
      // 更新dom，触发生命周期componentWillUnmounted componentDidMount componentDidUpdate
      // 三个阶段走完，就停止调度，让浏览器绘制页面
      commitRoot(root);
      break;
    }
    default: {
      invariant(false, 'Unknown root exit status.');
    }
  }
}

function markRootSuspended(root, suspendedLanes) {
  // When suspending, we should always exclude lanes that were pinged or (more
  // rarely, since we try to avoid it) updated during the render phase.
  // TODO: Lol maybe there's a better way to factor this besides this
  // obnoxiously named function :)
  suspendedLanes = removeLanes(suspendedLanes, workInProgressRootPingedLanes);
  suspendedLanes = removeLanes(suspendedLanes, workInProgressRootUpdatedLanes);
  markRootSuspended_dontCallThisOneDirectly(root, suspendedLanes);
}

// This is the entry point for synchronous tasks that don't go
// through Scheduler
// 从root开始执行同步工作，完成之后提交
// 执行renderRootSync，拿到返回值exitStatus，然后提交root
// 这里renderRootSync内部的workLoopSync是同步执行的，没有中断逻辑
function performSyncWorkOnRoot(root) {
  invariant(
    (executionContext & (RenderContext | CommitContext)) === NoContext,
    'Should not already be working.',
  );

  flushPassiveEffects();

  let lanes;
  let exitStatus;

  // 执行renderRootSync，拿到返回值exitStatus
  if (
    root === workInProgressRoot && // fiberRoot
    includesSomeLane(root.expiredLanes, workInProgressRootRenderLanes) // (a & b) !== NoLanes
  ) {
    // There's a partial tree, and at least one of its lanes has expired. Finish
    // rendering it before rendering the rest of the expired work.
    // 有lane过期了，优先更新
    lanes = workInProgressRootRenderLanes;
    // performUnitOfWork直到全局workInProgres为null
    // 整个performUnitOfWork的工作是 dom diff => 更新workInProgress.stateNode/设置workInProgress.updateQueue等到后续提交的时候更新
    // 这里的workLoopSync是同步执行的，没有中断逻辑
    // 返回workInProgressRootExitStatus
    exitStatus = renderRootSync(root, lanes);
    if (
      includesSomeLane(
        workInProgressRootIncludedLanes,
        workInProgressRootUpdatedLanes,
      )
    ) {
      // The render included lanes that were updated during the render phase.
      // For example, when unhiding a hidden tree, we include all the lanes
      // that were previously skipped when the tree was hidden. That set of
      // lanes is a superset of the lanes we started rendering with.
      //
      // Note that this only happens when part of the tree is rendered
      // concurrently. If the whole tree is rendered synchronously, then there
      // are no interleaved events.
      // 并发情况
      // included lanes和updated lanes有交集
      // 拿到下一批lanes，做performUnitOfWork
      lanes = getNextLanes(root, lanes);
      exitStatus = renderRootSync(root, lanes);
    }
  } else {
    // 没有lane过期
    // 拿到下一批lanes，做performUnitOfWork
    lanes = getNextLanes(root, NoLanes);
    exitStatus = renderRootSync(root, lanes);
  }

  if (root.tag !== LegacyRoot && exitStatus === RootErrored) {
    executionContext |= RetryAfterError;

    // If an error occurred during hydration,
    // discard server response and fall back to client side render.
    // SSR报错，切换成客户端渲染
    if (root.hydrate) {
      root.hydrate = false;
      clearContainer(root.containerInfo);
    }

    // If something threw an error, try rendering one more time. We'll render
    // synchronously to block concurrent data mutations, and we'll includes
    // all pending updates are included. If it still fails after the second
    // attempt, we'll give up and commit the resulting tree.
    // 渲染过程出错的话，会再尝试一下渲染，如果还是报错，就会放弃并提交结果tree
    lanes = getLanesToRetrySynchronouslyOnError(root);
    if (lanes !== NoLanes) {
      exitStatus = renderRootSync(root, lanes);
    }
  }

  // 出现致命错误
  if (exitStatus === RootFatalErrored) {
    const fatalError = workInProgressRootFatalError;
    // 重置调度队列
    prepareFreshStack(root, NoLanes);
    // 标记当前fiberRoot已经挂起
    markRootSuspended(root, lanes);
    // 确保当前fiberRoot已经被调度
    ensureRootIsScheduled(root, now());
    throw fatalError;
  }

  // We now have a consistent tree. Because this is a sync render, we
  // will commit it even if something suspended.
  // 到了这一步一个完整的fiber树就构建完毕
  // 每个单元任务workInProgress已经完成了 dom diff 和 workInProgress.stateNode/workInProgress.updateQueue
  // 此时就算有其他suspense操作，程序依然会提交fiber树
  const finishedWork: Fiber = (root.current.alternate: any); // rootFiber
  root.finishedWork = finishedWork; // rootFiber
  root.finishedLanes = lanes; // nextLanes
  // 整个root的提交
  // 这里就是先设置最新的调度优先级，然后执行commitRootImpl
  // 这里会走三个阶段before mutation  mutation  layout
  // 更新dom，触发生命周期componentWillUnmounted componentDidMount componentDidUpdate
  // 三个阶段走完，就停止调度，让浏览器绘制页面
  commitRoot(root);

  // Before exiting, make sure there's a callback scheduled for the next
  // pending level.
  // 最后在退出之前，我们计算下一批lanes的优先级情况
  ensureRootIsScheduled(root, now());

  return null;
}

export function flushRoot(root: FiberRoot, lanes: Lanes) {
  markRootExpired(root, lanes);
  ensureRootIsScheduled(root, now());
  if ((executionContext & (RenderContext | CommitContext)) === NoContext) {
    resetRenderTimer();
    flushSyncCallbackQueue();
  }
}

export function getExecutionContext(): ExecutionContext {
  return executionContext;
}

export function flushDiscreteUpdates() {
  // TODO: Should be able to flush inside batchedUpdates, but not inside `act`.
  // However, `act` uses `batchedUpdates`, so there's no way to distinguish
  // those two cases. Need to fix this before exposing flushDiscreteUpdates
  // as a public API.
  if (
    (executionContext & (BatchedContext | RenderContext | CommitContext)) !==
    NoContext
  ) {
    if (__DEV__) {
      if ((executionContext & RenderContext) !== NoContext) {
        console.error(
          'unstable_flushDiscreteUpdates: Cannot flush updates when React is ' +
            'already rendering.',
        );
      }
    }
    // We're already rendering, so we can't synchronously flush pending work.
    // This is probably a nested event dispatch triggered by a lifecycle/effect,
    // like `el.focus()`. Exit.
    return;
  }
  flushPendingDiscreteUpdates();
  // If the discrete updates scheduled passive effects, flush them now so that
  // they fire before the next serial event.
  flushPassiveEffects();
}

export function deferredUpdates<A>(fn: () => A): A {
  if (decoupleUpdatePriorityFromScheduler) {
    const previousLanePriority = getCurrentUpdateLanePriority();
    try {
      setCurrentUpdateLanePriority(DefaultLanePriority);
      return runWithPriority(NormalSchedulerPriority, fn);
    } finally {
      setCurrentUpdateLanePriority(previousLanePriority);
    }
  } else {
    return runWithPriority(NormalSchedulerPriority, fn);
  }
}

function flushPendingDiscreteUpdates() {
  if (rootsWithPendingDiscreteUpdates !== null) {
    // For each root with pending discrete updates, schedule a callback to
    // immediately flush them.
    const roots = rootsWithPendingDiscreteUpdates;
    rootsWithPendingDiscreteUpdates = null;
    roots.forEach((root) => {
      markDiscreteUpdatesExpired(root);
      ensureRootIsScheduled(root, now());
    });
  }
  // Now flush the immediate queue.
  flushSyncCallbackQueue();
}

export function batchedUpdates<A, R>(fn: (A) => R, a: A): R {
  const prevExecutionContext = executionContext;
  executionContext |= BatchedContext;
  try {
    return fn(a);
  } finally {
    executionContext = prevExecutionContext;
    if (executionContext === NoContext) {
      // Flush the immediate callbacks that were scheduled during this batch
      resetRenderTimer();
      flushSyncCallbackQueue();
    }
  }
}

export function batchedEventUpdates<A, R>(fn: (A) => R, a: A): R {
  const prevExecutionContext = executionContext;
  executionContext |= EventContext;
  try {
    return fn(a);
  } finally {
    executionContext = prevExecutionContext;
    if (executionContext === NoContext) {
      // Flush the immediate callbacks that were scheduled during this batch
      resetRenderTimer();
      flushSyncCallbackQueue();
    }
  }
}

export function discreteUpdates<A, B, C, D, R>(
  fn: (A, B, C) => R,
  a: A,
  b: B,
  c: C,
  d: D,
): R {
  const prevExecutionContext = executionContext;
  executionContext |= DiscreteEventContext;

  if (decoupleUpdatePriorityFromScheduler) {
    const previousLanePriority = getCurrentUpdateLanePriority();
    try {
      setCurrentUpdateLanePriority(InputDiscreteLanePriority);
      return runWithPriority(
        UserBlockingSchedulerPriority,
        fn.bind(null, a, b, c, d),
      );
    } finally {
      setCurrentUpdateLanePriority(previousLanePriority);
      executionContext = prevExecutionContext;
      if (executionContext === NoContext) {
        // Flush the immediate callbacks that were scheduled during this batch
        resetRenderTimer();
        flushSyncCallbackQueue();
      }
    }
  } else {
    try {
      return runWithPriority(
        UserBlockingSchedulerPriority,
        fn.bind(null, a, b, c, d),
      );
    } finally {
      executionContext = prevExecutionContext;
      if (executionContext === NoContext) {
        // Flush the immediate callbacks that were scheduled during this batch
        resetRenderTimer();
        flushSyncCallbackQueue();
      }
    }
  }
}

// 将executionContext(执行上下文)切换成LegacyUnbatchedContext(非批量上下文)
// 切换上下文之后再调用fn，之后再将executionContext恢复到之前的状态
export function unbatchedUpdates<A, R>(fn: (a: A) => R, a: A): R {
  const prevExecutionContext = executionContext;
  executionContext &= ~BatchedContext;
  executionContext |= LegacyUnbatchedContext;
  try {
    return fn(a);
  } finally {
    executionContext = prevExecutionContext;
    if (executionContext === NoContext) {
      // Flush the immediate callbacks that were scheduled during this batch
      resetRenderTimer();
      flushSyncCallbackQueue();
    }
  }
}

export function flushSync<A, R>(fn: (A) => R, a: A): R {
  const prevExecutionContext = executionContext;
  if ((prevExecutionContext & (RenderContext | CommitContext)) !== NoContext) {
    if (__DEV__) {
      console.error(
        'flushSync was called from inside a lifecycle method. React cannot ' +
          'flush when React is already rendering. Consider moving this call to ' +
          'a scheduler task or micro task.',
      );
    }
    return fn(a);
  }
  executionContext |= BatchedContext;

  if (decoupleUpdatePriorityFromScheduler) {
    const previousLanePriority = getCurrentUpdateLanePriority();
    try {
      setCurrentUpdateLanePriority(SyncLanePriority);
      if (fn) {
        return runWithPriority(ImmediateSchedulerPriority, fn.bind(null, a));
      } else {
        return (undefined: $FlowFixMe);
      }
    } finally {
      setCurrentUpdateLanePriority(previousLanePriority);
      executionContext = prevExecutionContext;
      // Flush the immediate callbacks that were scheduled during this batch.
      // Note that this will happen even if batchedUpdates is higher up
      // the stack.
      flushSyncCallbackQueue();
    }
  } else {
    try {
      if (fn) {
        return runWithPriority(ImmediateSchedulerPriority, fn.bind(null, a));
      } else {
        return (undefined: $FlowFixMe);
      }
    } finally {
      executionContext = prevExecutionContext;
      // Flush the immediate callbacks that were scheduled during this batch.
      // Note that this will happen even if batchedUpdates is higher up
      // the stack.
      flushSyncCallbackQueue();
    }
  }
}

export function flushControlled(fn: () => mixed): void {
  const prevExecutionContext = executionContext;
  executionContext |= BatchedContext;
  if (decoupleUpdatePriorityFromScheduler) {
    const previousLanePriority = getCurrentUpdateLanePriority();
    try {
      setCurrentUpdateLanePriority(SyncLanePriority);
      runWithPriority(ImmediateSchedulerPriority, fn);
    } finally {
      setCurrentUpdateLanePriority(previousLanePriority);

      executionContext = prevExecutionContext;
      if (executionContext === NoContext) {
        // Flush the immediate callbacks that were scheduled during this batch
        resetRenderTimer();
        flushSyncCallbackQueue();
      }
    }
  } else {
    try {
      runWithPriority(ImmediateSchedulerPriority, fn);
    } finally {
      executionContext = prevExecutionContext;
      if (executionContext === NoContext) {
        // Flush the immediate callbacks that were scheduled during this batch
        resetRenderTimer();
        flushSyncCallbackQueue();
      }
    }
  }
}

export function pushRenderLanes(fiber: Fiber, lanes: Lanes) {
  pushToStack(subtreeRenderLanesCursor, subtreeRenderLanes, fiber);
  subtreeRenderLanes = mergeLanes(subtreeRenderLanes, lanes);
  workInProgressRootIncludedLanes = mergeLanes(
    workInProgressRootIncludedLanes,
    lanes,
  );
}

export function popRenderLanes(fiber: Fiber) {
  subtreeRenderLanes = subtreeRenderLanesCursor.current;
  popFromStack(subtreeRenderLanesCursor, fiber);
}

// 重置root和全局workInProgress相关
function prepareFreshStack(root: FiberRoot, lanes: Lanes) {
  root.finishedWork = null;
  root.finishedLanes = NoLanes;

  const timeoutHandle = root.timeoutHandle;
  if (timeoutHandle !== noTimeout) {
    // The root previous suspended and scheduled a timeout to commit a fallback
    // state. Now that we have additional work, cancel the timeout.
    root.timeoutHandle = noTimeout;
    // $FlowFixMe Complains noTimeout is not a TimeoutID, despite the check above
    cancelTimeout(timeoutHandle);
  }

  if (workInProgress !== null) {
    let interruptedWork = workInProgress.return;
    while (interruptedWork !== null) {
      unwindInterruptedWork(interruptedWork);
      interruptedWork = interruptedWork.return;
    }
  }
  workInProgressRoot = root;
  workInProgress = createWorkInProgress(root.current, null);
  workInProgressRootRenderLanes = subtreeRenderLanes = workInProgressRootIncludedLanes = lanes;
  workInProgressRootExitStatus = RootIncomplete;
  workInProgressRootFatalError = null;
  workInProgressRootSkippedLanes = NoLanes;
  workInProgressRootUpdatedLanes = NoLanes;
  workInProgressRootPingedLanes = NoLanes;

  if (enableSchedulerTracing) {
    spawnedWorkDuringRender = null;
  }

  if (__DEV__) {
    ReactStrictModeWarnings.discardPendingWarnings();
  }
}

function handleError(root, thrownValue): void {
  do {
    let erroredWork = workInProgress;
    try {
      // Reset module-level state that was set during the render phase.
      resetContextDependencies();
      resetHooksAfterThrow();
      resetCurrentDebugFiberInDEV();
      // TODO: I found and added this missing line while investigating a
      // separate issue. Write a regression test using string refs.
      ReactCurrentOwner.current = null;

      if (erroredWork === null || erroredWork.return === null) {
        // Expected to be working on a non-root fiber. This is a fatal error
        // because there's no ancestor that can handle it; the root is
        // supposed to capture all errors that weren't caught by an error
        // boundary.
        workInProgressRootExitStatus = RootFatalErrored;
        workInProgressRootFatalError = thrownValue;
        // Set `workInProgress` to null. This represents advancing to the next
        // sibling, or the parent if there are no siblings. But since the root
        // has no siblings nor a parent, we set it to null. Usually this is
        // handled by `completeUnitOfWork` or `unwindWork`, but since we're
        // intentionally not calling those, we need set it here.
        // TODO: Consider calling `unwindWork` to pop the contexts.
        workInProgress = null;
        return;
      }

      if (enableProfilerTimer && erroredWork.mode & ProfileMode) {
        // Record the time spent rendering before an error was thrown. This
        // avoids inaccurate Profiler durations in the case of a
        // suspended render.
        stopProfilerTimerIfRunningAndRecordDelta(erroredWork, true);
      }

      throwException(
        root,
        erroredWork.return,
        erroredWork,
        thrownValue,
        workInProgressRootRenderLanes,
      );
      completeUnitOfWork(erroredWork);
    } catch (yetAnotherThrownValue) {
      // Something in the return path also threw.
      thrownValue = yetAnotherThrownValue;
      if (workInProgress === erroredWork && erroredWork !== null) {
        // If this boundary has already errored, then we had trouble processing
        // the error. Bubble it to the next boundary.
        erroredWork = erroredWork.return;
        workInProgress = erroredWork;
      } else {
        erroredWork = workInProgress;
      }
      continue;
    }
    // Return to the normal work loop.
    return;
  } while (true);
}

// ReactCurrentDispatcher.current有就取，没有就取ContextOnlyDispatcher
function pushDispatcher() {
  const prevDispatcher = ReactCurrentDispatcher.current;
  ReactCurrentDispatcher.current = ContextOnlyDispatcher;
  if (prevDispatcher === null) {
    // The React isomorphic package does not include a default dispatcher.
    // Instead the first renderer will lazily attach one, in order to give
    // nicer error messages.
    return ContextOnlyDispatcher;
  } else {
    return prevDispatcher;
  }
}

function popDispatcher(prevDispatcher) {
  ReactCurrentDispatcher.current = prevDispatcher;
}

// 暂存之前的交互interactions，用于之后恢复
// 设置当前值__interactionsRef.current为root.memoizedInteractions
function pushInteractions(root) {
  if (enableSchedulerTracing) {
    const prevInteractions: Set<Interaction> | null = __interactionsRef.current;
    __interactionsRef.current = root.memoizedInteractions;
    return prevInteractions;
  }
  return null;
}

function popInteractions(prevInteractions) {
  if (enableSchedulerTracing) {
    __interactionsRef.current = prevInteractions;
  }
}

export function markCommitTimeOfFallback() {
  globalMostRecentFallbackTime = now();
}

export function markSkippedUpdateLanes(lane: Lane | Lanes): void {
  workInProgressRootSkippedLanes = mergeLanes(
    lane,
    workInProgressRootSkippedLanes,
  );
}

export function renderDidSuspend(): void {
  if (workInProgressRootExitStatus === RootIncomplete) {
    workInProgressRootExitStatus = RootSuspended;
  }
}

export function renderDidSuspendDelayIfPossible(): void {
  if (
    workInProgressRootExitStatus === RootIncomplete ||
    workInProgressRootExitStatus === RootSuspended
  ) {
    workInProgressRootExitStatus = RootSuspendedWithDelay;
  }

  // Check if there are updates that we skipped tree that might have unblocked
  // this render.
  if (
    workInProgressRoot !== null &&
    (includesNonIdleWork(workInProgressRootSkippedLanes) ||
      includesNonIdleWork(workInProgressRootUpdatedLanes))
  ) {
    // Mark the current render as suspended so that we switch to working on
    // the updates that were skipped. Usually we only suspend at the end of
    // the render phase.
    // TODO: We should probably always mark the root as suspended immediately
    // (inside this function), since by suspending at the end of the render
    // phase introduces a potential mistake where we suspend lanes that were
    // pinged or updated while we were rendering.
    markRootSuspended(workInProgressRoot, workInProgressRootRenderLanes);
  }
}

export function renderDidError() {
  if (workInProgressRootExitStatus !== RootCompleted) {
    workInProgressRootExitStatus = RootErrored;
  }
}

// Called during render to determine if anything has suspended.
// Returns false if we're not sure.
export function renderHasNotSuspendedYet(): boolean {
  // If something errored or completed, we can't really be sure,
  // so those are false.
  return workInProgressRootExitStatus === RootIncomplete;
}

// performUnitOfWork直到全局workInProgres为null
// 整个performUnitOfWork的工作是 dom diff => 更新workInProgress.stateNode/设置workInProgress.updateQueue等到后续提交的时候更新
// 这里的workLoopSync是同步执行的，没有中断逻辑
// 返回workInProgressRootExitStatus
// root  fiberRoot
// lanes  workInProgressRootRenderLanes
function renderRootSync(root: FiberRoot, lanes: Lanes) {
  // 保存当前执行上下文executionContext，用于之后恢复
  const prevExecutionContext = executionContext;
  // 更新执行上下文executionContext
  executionContext |= RenderContext;
  // 暂存之前的dispatcher，用于之后恢复
  // ReactCurrentDispatcher.current有就取，没有就取ContextOnlyDispatcher
  const prevDispatcher = pushDispatcher();

  // If the root or lanes have changed, throw out the existing stack
  // and prepare a fresh one. Otherwise we'll continue where we left off.
  // root或者lanes发生了变化，当前要更新的节点并非是队列中要更新的节点，也就是说被新的高优先级的任务给打断了
  // workInProgressRoot 接下来要更新的节点
  // workInProgressRootRenderLanes 接下来更新节点的过期时间
  if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
    // 重置root和全局workInProgress相关
    prepareFreshStack(root, lanes);
    // 将调度优先级高的interaction加入到interactions中
    startWorkOnPendingInteractions(root, lanes);
  }

  // 暂存之前的interactions交互，用于之后恢复
  // 更新当前interactions交互
  const prevInteractions = pushInteractions(root);

  if (__DEV__) {
    if (enableDebugTracing) {
      logRenderStarted(lanes);
    }
  }

  // 标记render开始
  if (enableSchedulingProfiler) {
    markRenderStarted(lanes);
  }

  do {
    try {
      // workLoopSync就是render的核心逻辑
      // 会一直performUnitOfWork直到全局workInProgres为null，然后这边跳出循环
      // 整个performUnitOfWork的工作是 dom diff => 更新workInProgress.stateNode/设置workInProgress.updateQueue等到后续提交的时候更新
      // 这里的workLoopSync是同步执行的，没有中断逻辑
      workLoopSync();
      break;
    } catch (thrownValue) {
      handleError(root, thrownValue);
    }
  } while (true);
  // 重置上下文依赖
  resetContextDependencies();
  // 恢复之前的interactions交互
  if (enableSchedulerTracing) {
    popInteractions(((prevInteractions: any): Set<Interaction>));
  }

  // 恢复为之前的执行上下文
  executionContext = prevExecutionContext;
  // 恢复之前的dispatcher
  popDispatcher(prevDispatcher);

  if (workInProgress !== null) {
    // This is a sync render, so we should have finished the whole tree.
    invariant(
      false,
      'Cannot commit an incomplete root. This error is likely caused by a ' +
        'bug in React. Please file an issue.',
    );
  }

  if (__DEV__) {
    if (enableDebugTracing) {
      logRenderStopped();
    }
  }

  // 标记render结束
  if (enableSchedulingProfiler) {
    markRenderStopped();
  }

  // Set this to null to indicate there's no in-progress render.
  // 清空workInProgressRoot和workInProgressRootRenderLanes，表示render完毕
  workInProgressRoot = null;
  workInProgressRootRenderLanes = NoLanes;

  return workInProgressRootExitStatus;
}

// The work loop is an extremely hot path. Tell Closure not to inline it.
/** @noinline */
// render的核心逻辑
// 会一直performUnitOfWork直到全局workInProgres为null，然后这边跳出循环
// 整个performUnitOfWork的工作是 dom diff => 更新workInProgress.stateNode/设置workInProgress.updateQueue等到后续提交的时候更新
function workLoopSync() {
  // Already timed out, so perform work without checking if we need to yield.
  while (workInProgress !== null) {
    // 整个performUnitOfWork的工作是 dom diff => 更新workInProgress.stateNode/设置workInProgress.updateQueue等到后续提交的时候更新
    performUnitOfWork(workInProgress);
  }
}

// renderRootSync的异步版本，可中断
// 核心逻辑workLoopConcurrent，每个循环（也就是更新每一个workInProgress）都会判断是否需要移交控制权给浏览器，以此实现时间切片
// 中断后返回 RootIncomplete
// 没有中断直接返回 workInProgressRootExitStatus
function renderRootConcurrent(root: FiberRoot, lanes: Lanes) {
  // 保存当前执行上下文executionContext，用于之后恢复
  const prevExecutionContext = executionContext;
  // 更新执行上下文executionContext
  executionContext |= RenderContext;
  // 暂存之前的dispatcher，用于之后恢复
  // ReactCurrentDispatcher.current有就取，没有就取ContextOnlyDispatcher
  const prevDispatcher = pushDispatcher();

  // If the root or lanes have changed, throw out the existing stack
  // and prepare a fresh one. Otherwise we'll continue where we left off.
  // root或者lanes发生了变化，当前要更新的节点并非是队列中要更新的节点，也就是说被新的高优先级的任务给打断了
  // workInProgressRoot 接下来要更新的节点
  // workInProgressRootRenderLanes 接下来更新节点的过期时间
  if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
    resetRenderTimer();
    prepareFreshStack(root, lanes);
    startWorkOnPendingInteractions(root, lanes);
  }

  // 暂存之前的interactions交互，用于之后恢复
  // 更新当前interactions交互
  const prevInteractions = pushInteractions(root);

  if (__DEV__) {
    if (enableDebugTracing) {
      logRenderStarted(lanes);
    }
  }

  // 标记render开始
  if (enableSchedulingProfiler) {
    markRenderStarted(lanes);
  }

  do {
    try {
      // workLoopSync的异步版本，可中断
      workLoopConcurrent();
      break;
    } catch (thrownValue) {
      handleError(root, thrownValue);
    }
  } while (true);
  // 重置上下文依赖
  resetContextDependencies();
  // 恢复之前的interactions交互
  if (enableSchedulerTracing) {
    popInteractions(((prevInteractions: any): Set<Interaction>));
  }

  // 恢复之前的dispatcher
  popDispatcher(prevDispatcher);
  // 恢复为之前的执行上下文
  executionContext = prevExecutionContext;

  if (__DEV__) {
    if (enableDebugTracing) {
      logRenderStopped();
    }
  }

  // Check if the tree has completed.
  // 检查整个树是否完成了render，也就是workLoopConcurrent过程中是否发生了中断
  if (workInProgress !== null) {
    // Still work remaining.
    // 未完成，标记 --render-yield，返回 RootIncomplete
    if (enableSchedulingProfiler) {
      markRenderYielded();
    }
    return RootIncomplete;
  } else {
    // Completed the tree.
    // 已完成，标记 --render-stop，返回 workInProgressRootExitStatus
    if (enableSchedulingProfiler) {
      markRenderStopped();
    }

    // Set this to null to indicate there's no in-progress render.
    // 清空workInProgressRoot和workInProgressRootRenderLanes
    workInProgressRoot = null;
    workInProgressRootRenderLanes = NoLanes;

    // Return the final exit status.
    return workInProgressRootExitStatus;
  }
}

/** @noinline */
// workLoopSync 的异步版本，可中断
// 更新每一个workInProgress时都会做判断，实现时间切片更新
// 中断之后 workInProgress 会保持有值的状态，等待下一个切片更新
function workLoopConcurrent() {
  // Perform work until Scheduler asks us to yield
  // shouldYield 返回 getCurrentTime() >= deadline，表示超时了，需要中断更新并移交控制权给浏览器
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress);
  }
}

// render的核心逻辑
// 执行每个单元任务unitOfWork(workInProgress)的render工作
// 核心逻辑 beginWork => completeUnitOfWork => 设置下一个单元任务workInProgress => 循环直至没有下一个单元任务
// beginWork 内部核心逻辑一是处理updateQueue.shared.pending链表和updateQueue.baseQueue链表生成新state，根据新state执行render函数生成新children
// beginWork 内部核心逻辑二是对新children进行reconcileChildren，也就是dom diff，更新workInProgress.child为下一个单元工作
// beginWork reconcileChildren过程中会对newChild(如果是数组)中的每一项生成(新创建或复用)newFiber，并设置每一个newFiber的child sibling return
// completeUnitOfWork 内部核心逻辑一是completeWork，处理与dom相关的更新替换，将workInProgress.stateNode更新为最新的dom(复用(复用有两种，一种是直接替换，另一种是设置workInProgress.updateQueue等到后续提交的时候更新)或者新创建)，并完成整个dom的子dom结构
// completeUnitOfWork 内部核心逻辑二是更新父workInProgress的effect list链表，将当前unitOfWork(也就是completedWork)的effect list(只包含其children)以及自身(如有副作用)添加到父workInProgress的effect list链表的最后
// 整个performUnitOfWork的工作是 生成新state => 生成新children用于reconcileChildren(也就是dom diff) => 更新workInProgress.stateNode/设置workInProgress.updateQueue等到后续提交的时候更新 => 更新父workInProgress的effect list链表
function performUnitOfWork(unitOfWork: Fiber): void {
  // The current, flushed, state of this fiber is the alternate. Ideally
  // nothing should rely on this, but relying on it here means that we don't
  // need an additional field on the work in progress.

  // unitOfWork对应的原来的currentFiber
  const current = unitOfWork.alternate;
  setCurrentDebugFiberInDEV(unitOfWork);

  let next;
  if (enableProfilerTimer && (unitOfWork.mode & ProfileMode) !== NoMode) {
    // 记录开始时间
    startProfilerTimer(unitOfWork);
    // beginWork返回的下一个单元任务next指向unitOfWork的child，也就是第一个子fiber
    // 核心逻辑一是处理updateQueue.shared.pending链表和updateQueue.baseQueue链表生成新state，根据新state执行render函数生成新children
    // 核心逻辑二是对新children进行reconcileChildren，也就是dom diff，更新workInProgress.child为下一个单元工作
    // reconcileChildren过程中会对newChild(如果是数组)中的每一项生成(新创建或复用)newFiber，并设置每一个newFiber的child sibling return
    // 这里会对newChild(如果是数组)中的每一项生成(新创建或复用)newFiber，并设置每一个newFiber的child sibling return
    next = beginWork(current, unitOfWork, subtreeRenderLanes);
    // 记录结束时间，更新unitOfWork的render持续时间
    stopProfilerTimerIfRunningAndRecordDelta(unitOfWork, true);
  } else {
    next = beginWork(current, unitOfWork, subtreeRenderLanes);
  }

  resetCurrentDebugFiberInDEV();
  // unitOfWork render完毕，将当前props更新为新的props
  unitOfWork.memoizedProps = unitOfWork.pendingProps;
  // next指向unitOfWork.child，也就是第一个子fiber
  // next存在，设置workInProgress
  // next不存在，完成当前单元任务，也就是dom diff并更新到真实dom上，设置workInProgress为unitOfWork.sibling => return => return.sibling
  // 两种情况下都没有下一个单元任务设置workInProgress，表示所有单元任务完成，结束循环，结束workLoopSync
  if (next === null) {
    // If this doesn't spawn new work, complete the current work.
    // beginWork中找不到下一个单元任务next（也就是第一个子fiber，表示不存在children），就对当前单元任务unitOfWork进行completeUnitOfWork
    // completeUnitOfWork过程中会找到下一个单元任务赋值到workInProgress，循环继续执行performUnitOfWork
    // 如果completeUnitOfWork过程中没有下一个单元任务了，那就结束循环，结束workLoopSync
    // 内部核心逻辑一是completeWork，处理与dom相关的更新替换，将workInProgress.stateNode更新为最新的dom(复用(复用有两种，一种是直接替换，另一种是设置workInProgress.updateQueue等到后续提交的时候更新)或者新创建)，并完成整个dom的子dom结构
    // 内部核心逻辑二是更新父workInProgress的effect list链表，将当前unitOfWork(也就是completedWork)的effect list(只包含其children)以及自身(如有副作用)添加到父workInProgress的effect list链表的最后
    // 按照sibling => ... => return => return.sibling => ... 的顺序
    // 走到这里的unitOfWork，表示已经没有children了，所以这里只取sibling和return
    completeUnitOfWork(unitOfWork);
  } else {
    // beginWork中找到了下一个单元任务next（也就是第一个子fiber，表示存在children），直接将next赋值到workInProgress，循环继续执行performUnitOfWork
    workInProgress = next;
  }

  ReactCurrentOwner.current = null;
}

// 完成当前单元任务unitOfWork，然后设置下一个单元任务workInProgress，循环继续执行performUnitOfWork
// 内部核心逻辑一是completeWork，处理与dom相关的更新替换，将workInProgress.stateNode更新为最新的dom(复用(复用有两种，一种是直接替换，另一种是设置workInProgress.updateQueue等到后续提交的时候更新)或者新创建)，并完成整个dom的子dom结构
// 内部核心逻辑二是更新父workInProgress的effect list链表，将当前unitOfWork(也就是completedWork)的effect list(只包含其children)以及自身(如有副作用)添加到父workInProgress的effect list链表的最后
// 按照sibling => ... => return => return.sibling => ... 的顺序
// 走到这里的unitOfWork，表示已经没有children了，所以这里只取sibling和return
function completeUnitOfWork(unitOfWork: Fiber): void {
  // Attempt to complete the current unit of work, then move to the next
  // sibling. If there are no more siblings, return to the parent fiber.
  // 尝试完成当前的单元任务fiber，然后移动到下一个sibling，如果没有，就移动到父fiber
  let completedWork = unitOfWork;
  do {
    // The current, flushed, state of this fiber is the alternate. Ideally
    // nothing should rely on this, but relying on it here means that we don't
    // need an additional field on the work in progress.
    const current = completedWork.alternate; // currentFiber
    const returnFiber = completedWork.return; // 父fiber

    // Check if the work completed or if something threw.
    // 检查计算工作是否完成，或者是否有某些报错
    if ((completedWork.flags & Incomplete) === NoFlags) {
      // 已完成
      // 将completedWork转换为真实dom，更新completedWork的childLanes actualDuration treeBaseDuration
      // 更新父workInProgress的update队列

      setCurrentDebugFiberInDEV(completedWork);
      let next;
      if (
        !enableProfilerTimer ||
        (completedWork.mode & ProfileMode) === NoMode
      ) {
        // 将completedWork转换为真实dom
        // 这里的工作是处理与dom相关的更新替换，将workInProgress转变为真实dom
        // 让workInProgress.stateNode更新为最新的dom(复用(复用有两种，一种是直接替换，另一种是设置workInProgress.updateQueue等到后续提交的时候更新)或者新创建)，并完成整个dom的子dom结构
        // 原生dom fiber还会diff props初始化dom属性
        next = completeWork(current, completedWork, subtreeRenderLanes);
      } else {
        // render持续时间累加上completeWork的时间得到最新的render持续时间

        // 记录开始时间
        startProfilerTimer(completedWork);
        // 将completedWork转换为真实dom
        // 这里的工作是处理与dom相关的更新替换，将workInProgress转变为真实dom
        // 让workInProgress.stateNode更新为最新的dom(复用(复用有两种，一种是直接替换，另一种是设置workInProgress.updateQueue等到后续提交的时候更新)或者新创建)，并完成整个dom的子dom结构
        // 原生dom fiber还会diff props初始化dom属性
        next = completeWork(current, completedWork, subtreeRenderLanes);
        // Update render duration assuming we didn't error.
        // 记录结束时间，更新render持续时间
        stopProfilerTimerIfRunningAndRecordDelta(completedWork, false);
      }
      resetCurrentDebugFiberInDEV();

      // 正常情况next应该为null
      // next不为null，就赋值给workInProgress，继续运算
      if (next !== null) {
        // Completing this fiber spawned new work. Work on that next.
        workInProgress = next;
        return;
      }
      // 更新completedWork的childLanes actualDuration treeBaseDuration
      // childLanes 所有children的泳道，包括深层的所有children
      // actualDuration render时间
      // treeBaseDuration completeWork时间
      resetChildLanes(completedWork);

      // 更新父workInProgress的effect队列
      if (
        returnFiber !== null &&
        // Do not append effects to parents if a sibling failed to complete
        (returnFiber.flags & Incomplete) === NoFlags
      ) {
        // Append all the effects of the subtree and this fiber onto the effect
        // list of the parent. The completion order of the children affects the
        // side-effect order.
        // 父workInProgress未完成

        // 将completedWork的effect list(这里只包含children的，不包含自身，自身在下面做单独处理)追加到父workInProgress的effect list的最后
        // 父workInProgress没有effect list队列，把completedWork的整个effect list队列给到父workInProgress
        // 父workInProgress有effect list队列，就把completedWork的lastEffect给到父workInProgress的lastEffect
        if (returnFiber.firstEffect === null) {
          returnFiber.firstEffect = completedWork.firstEffect;
        }
        if (completedWork.lastEffect !== null) {
          if (returnFiber.lastEffect !== null) {
            returnFiber.lastEffect.nextEffect = completedWork.firstEffect;
          }
          returnFiber.lastEffect = completedWork.lastEffect;
        }

        // If this fiber had side-effects, we append it AFTER the children's
        // side-effects. We can perform certain side-effects earlier if needed,
        // by doing multiple passes over the effect list. We don't want to
        // schedule our own side-effect on our own list because if end up
        // reusing children we'll schedule this effect onto itself since we're
        // at the end.
        // completedWork的副作用flags
        const flags = completedWork.flags;

        // Skip both NoWork and PerformedWork tags when creating the effect
        // list. PerformedWork effect is read by React DevTools but shouldn't be
        // committed.
        // 跳过NoWork和PerformedWork
        // PerformedWork是用来被React DevTools读取的，不用被commit
        // 将completedWork自身追加到父workInProgress的effect list的最后(如果completedWork自身有副作用，通过 flags > PerformedWork 判断)
        // 这步结束，完成completedWork的effect list(也就是其children的副作用链表)以及自身(如有副作用)添加到父workInProgress的effect list的最后
        if (flags > PerformedWork) {
          // 父workInProgress没有update队列，把completedWork作为父workInProgress的整个update队列
          //    这种情况是父workInProgress和completedWork都没有update队列
          // 父workInProgress有update队列，就把completedWork更新为父workInProgress的lastEffect
          //    这种情况是父workInProgress的update队列会依次加上completedWork.lastEffect和completedWork
          if (returnFiber.lastEffect !== null) {
            returnFiber.lastEffect.nextEffect = completedWork;
          } else {
            returnFiber.firstEffect = completedWork;
          }
          returnFiber.lastEffect = completedWork;
        }
      }
    } else {
      // This fiber did not complete because something threw. Pop values off
      // the stack without entering the complete phase. If this is a boundary,
      // capture values if possible.
      // 未完成或有某些报错
      // 有next，就给到workInProgress继续运算
      // 没有next，就更新render时间completedWork.actualDuration，标记父workInProgress未完成，并清空update队列

      const next = unwindWork(completedWork, subtreeRenderLanes);

      // Because this fiber did not complete, don't reset its expiration time.
      // completedWork没有完成，所以不能重置过期时间

      // 移除非HostEffectMask，并将未完成的next赋值给workInProgress，继续运算
      if (next !== null) {
        // If completing this work spawned new work, do that next. We'll come
        // back here again.
        // Since we're restarting, remove anything that is not a host effect
        // from the effect tag.
        next.flags &= HostEffectMask;
        workInProgress = next;
        return;
      }

      // 更新render时间completedWork.actualDuration
      if (
        enableProfilerTimer &&
        (completedWork.mode & ProfileMode) !== NoMode
      ) {
        // Record the render duration for the fiber that errored.
        // 更新render时间completedWork.actualDuration
        stopProfilerTimerIfRunningAndRecordDelta(completedWork, false);

        // Include the time spent working on failed children before continuing.
        // 算上未完成的所有children所需要的时间，加到completedWork.actualDuration上
        let actualDuration = completedWork.actualDuration;
        let child = completedWork.child;
        while (child !== null) {
          actualDuration += child.actualDuration;
          child = child.sibling;
        }
        // 更新completedWork.actualDuration
        completedWork.actualDuration = actualDuration;
      }

      // 标记父workInProgress未完成，并清空update队列
      if (returnFiber !== null) {
        // Mark the parent fiber as incomplete and clear its effect list.
        returnFiber.firstEffect = returnFiber.lastEffect = null;
        returnFiber.flags |= Incomplete;
      }
    }

    // 正常情况下会到这里，也就是completedWork已完成
    // 兄弟节点的计算
    const siblingFiber = completedWork.sibling;
    // 一般有兄弟节点就直接将下一个workInProgress指向这个兄弟节点，接着workLoop
    if (siblingFiber !== null) {
      // If there is more work to do in this returnFiber, do that next.
      workInProgress = siblingFiber;
      return;
    }
    // Otherwise, return to the parent
    // 没有兄弟节点，就返回父workInProgress，接着父节点的兄弟节点workLoop
    completedWork = returnFiber;
    // Update the next thing we're working on in case something throws.
    // 把父workInProgress给到workInProgress，是处理children的未完成或抛出错误的情况
    workInProgress = completedWork;
  } while (completedWork !== null);

  // We've reached the root.
  // 这里已经循环完成单元任务unitOfWork，重新回到了root，标记root完成
  if (workInProgressRootExitStatus === RootIncomplete) {
    workInProgressRootExitStatus = RootCompleted;
  }
}

// completedWork  已经进行过completeWork的workInProgress
// completeWork是将workInProgress转换为真实dom
// 这里的工作是更新completedWork的childLanes actualDuration treeBaseDuration
// childLanes 所有children的泳道，包括深层的所有children
// actualDuration render时间
// treeBaseDuration completeWork时间
function resetChildLanes(completedWork: Fiber) {
  if (
    // TODO: Move this check out of the hot path by moving `resetChildLanes`
    // to switch statement in `completeWork`.
    (completedWork.tag === LegacyHiddenComponent ||
      completedWork.tag === OffscreenComponent) &&
    completedWork.memoizedState !== null &&
    !includesSomeLane(subtreeRenderLanes, (OffscreenLane: Lane)) &&
    (completedWork.mode & ConcurrentMode) !== NoLanes
  ) {
    // The children of this component are hidden. Don't bubble their
    // expiration times.
    return;
  }

  let newChildLanes = NoLanes;

  // Bubble up the earliest expiration time.
  if (enableProfilerTimer && (completedWork.mode & ProfileMode) !== NoMode) {
    // In profiling mode, resetChildExpirationTime is also used to reset
    // profiler durations.
    // render持续时间
    let actualDuration = completedWork.actualDuration;
    // completeWork的持续时间
    let treeBaseDuration = ((completedWork.selfBaseDuration: any): number);

    // When a fiber is cloned, its actualDuration is reset to 0. This value will
    // only be updated if work is done on the fiber (i.e. it doesn't bailout).
    // When work is done, it should bubble to the parent's actualDuration. If
    // the fiber has not been cloned though, (meaning no work was done), then
    // this value will reflect the amount of time spent working on a previous
    // render. In that case it should not bubble. We determine whether it was
    // cloned by comparing the child pointer.
    // completedWork没有currentFiber或child !== currentFiber.Children
    // 说明还没有开始工作
    // 这里就不需要bubble actualDuration
    const shouldBubbleActualDurations =
      completedWork.alternate === null ||
      completedWork.child !== completedWork.alternate.child;

    let child = completedWork.child;
    // 遍历completedWork的所有子节点
    // 更新newChildLanes actualDuration treeBaseDuration
    while (child !== null) {
      newChildLanes = mergeLanes(
        newChildLanes,
        mergeLanes(child.lanes, child.childLanes), // child的总lanes
      );
      // completedWork的render持续时间累加上child的render持续时间
      if (shouldBubbleActualDurations) {
        actualDuration += child.actualDuration;
      }
      // completedWork的completeWork持续时间累加上child的completeWork持续时间
      treeBaseDuration += child.treeBaseDuration;
      child = child.sibling;
    }

    // treeBaseDuration减去suspense的child的treeBaseDuration
    const isTimedOutSuspense =
      completedWork.tag === SuspenseComponent &&
      completedWork.memoizedState !== null;
    if (isTimedOutSuspense) {
      // Don't count time spent in a timed out Suspense subtree as part of the base duration.
      const primaryChildFragment = completedWork.child;
      if (primaryChildFragment !== null) {
        treeBaseDuration -= ((primaryChildFragment.treeBaseDuration: any): number);
      }
    }

    // actualDuration和treeBaseDuration更新到completedWork上
    completedWork.actualDuration = actualDuration;
    completedWork.treeBaseDuration = treeBaseDuration;
  } else {
    // 不做时间计算，只更新newChildLanes
    let child = completedWork.child;
    while (child !== null) {
      newChildLanes = mergeLanes(
        newChildLanes,
        mergeLanes(child.lanes, child.childLanes),
      );
      child = child.sibling;
    }
  }

  // 将newChildLanes更新到completedWork上
  completedWork.childLanes = newChildLanes;
}

// 提交fiberRoot
// 这里会走三个阶段before mutation  mutation  layout
// 更新dom，触发生命周期componentWillUnmounted componentDidMount componentDidUpdate
// 三个阶段走完，就停止调度，让浏览器绘制页面
function commitRoot(root) {
  // 当前render优先级
  const renderPriorityLevel = getCurrentPriorityLevel();
  // 设置最新的调度优先级，然后执行回调commitRootImpl.bind(null, root, renderPriorityLevel)
  runWithPriority(
    ImmediateSchedulerPriority,
    commitRootImpl.bind(null, root, renderPriorityLevel),
  );
  return null;
}

// 先设置最新的调度优先级，然后会执行这个函数
// 整个root的提交
// 这里会走三个阶段before mutation  mutation  layout
// 更新dom，触发生命周期componentWillUnmounted(对应useEffect的返回值函数) componentDidMount(对应useEffect) componentDidUpdate(对应useEffect)
// 三个阶段走完，就停止调度，让浏览器绘制页面
function commitRootImpl(root, renderPriorityLevel) {
  do {
    // `flushPassiveEffects` will call `flushSyncUpdateQueue` at the end, which
    // means `flushPassiveEffects` will sometimes result in additional
    // passive effects. So we need to keep flushing in a loop until there are
    // no more pending effects.
    // TODO: Might be better if `flushPassiveEffects` did not automatically
    // flush synchronous work at the end, to avoid factoring hazards like this.
    flushPassiveEffects();
  } while (rootWithPendingPassiveEffects !== null);
  flushRenderPhaseStrictModeWarningsInDEV();

  invariant(
    (executionContext & (RenderContext | CommitContext)) === NoContext,
    'Should not already be working.',
  );

  const finishedWork = root.finishedWork; // rootFiber
  const lanes = root.finishedLanes; // nextLanes

  if (__DEV__) {
    if (enableDebugTracing) {
      logCommitStarted(lanes);
    }
  }

  // 标记提交开始
  if (enableSchedulingProfiler) {
    markCommitStarted(lanes);
  }

  // 没有finishedWork，直接结束提交
  if (finishedWork === null) {
    if (__DEV__) {
      if (enableDebugTracing) {
        logCommitStopped();
      }
    }

    // 标记提交结束
    if (enableSchedulingProfiler) {
      markCommitStopped();
    }

    return null;
  }
  // 清空fiberRoot的finishedWork和finishedLanes
  root.finishedWork = null;
  root.finishedLanes = NoLanes;

  invariant(
    finishedWork !== root.current,
    'Cannot commit the same tree as before. This error is likely caused by ' +
      'a bug in React. Please file an issue.',
  );

  // commitRoot never returns a continuation; it always finishes synchronously.
  // So we can clear these now to allow a new callback to be scheduled.
  // commitRoot阶段不允许中断，总是同步完成的
  // 所以这里直接清空fiberRoot的callbackNode，允许添加一个新的调度callback
  root.callbackNode = null;

  // Update the first and last pending times on this root. The new first
  // pending time is whatever is left on the root fiber.
  // 合并rootFiber.lanes和rootFiber.childLanes，更新为remainingLanes
  let remainingLanes = mergeLanes(finishedWork.lanes, finishedWork.childLanes);

  // 保留fiberRoot.pendingLanes中的remainingLanes
  // 更新suspendedLanes pingedLanes expiredLanes mutableReadLanes entangledLanes
  // 其他的lanes做清空处理
  markRootFinished(root, remainingLanes);

  // Clear already finished discrete updates in case that a later call of
  // `flushDiscreteUpdates` starts a useless render pass which may cancels
  // a scheduled timeout.
  // rootsWithPendingDiscreteUpdates中移除fiberRoot，避免执行无用的render
  if (rootsWithPendingDiscreteUpdates !== null) {
    if (
      !hasDiscreteLanes(remainingLanes) &&
      rootsWithPendingDiscreteUpdates.has(root)
    ) {
      rootsWithPendingDiscreteUpdates.delete(root);
    }
  }

  if (root === workInProgressRoot) {
    // We can reset these now that they are finished.
    // 全部完成，重置workInProgressRoot workInProgress workInProgressRootRenderLanes
    workInProgressRoot = null;
    workInProgress = null;
    workInProgressRootRenderLanes = NoLanes;
  } else {
    // This indicates that the last root we worked on is not the same one that
    // we're committing now. This most commonly happens when a suspended root
    // times out.
    // 处理的上一个根workInProgressRoot不是fiberRoot
    // 一般发生在 有suspended root超时的情况
  }

  // Get the list of effects.
  let firstEffect;
  // 更新effect list队列，用于之后的三个阶段的遍历
  // 这里主要是将自身添加到effect单链表最后(如果自身有副作用)，在这之前，effect单链表只保存其有副作用更新的children
  // effect list存储了有副作用的fiber，也就是需要更新dom的fiber
  if (finishedWork.flags > PerformedWork) {
    // A fiber's effect list consists only of its children, not itself. So if
    // the root has an effect, we need to add it to the end of the list. The
    // resulting list is the set that would belong to the root's parent, if it
    // had one; that is, all the effects in the tree including the root.
    // rootFiber有副作用工作
    // fiber的effect list只包含children的，这里将自身添加到这个effect list的最后
    if (finishedWork.lastEffect !== null) {
      finishedWork.lastEffect.nextEffect = finishedWork;
      firstEffect = finishedWork.firstEffect;
    } else {
      firstEffect = finishedWork;
    }
  } else {
    // There is no effect on the root.
    // rootFiber没有副作用工作
    // 不需要在effect list中添加自身
    firstEffect = finishedWork.firstEffect;
  }

  if (firstEffect !== null) {
    // 有effect，需要更新
    // 这里会对effect list中的每一个fiber都走三个阶段before mutation  mutation  layout
    // 更新dom，触发生命周期componentWillUnmounted componentDidMount componentDidUpdate
    // 三个阶段走完，就停止调度，让浏览器绘制页面

    let previousLanePriority;
    // 暂存之前的lane优先级，用于之后恢复
    // 设置当前的为SyncLanePriority
    if (decoupleUpdatePriorityFromScheduler) {
      previousLanePriority = getCurrentUpdateLanePriority();
      setCurrentUpdateLanePriority(SyncLanePriority);
    }

    // 暂存之前的执行上下文，用于之后恢复
    // 更新当前执行上下文，表示是提交状态
    const prevExecutionContext = executionContext;
    executionContext |= CommitContext;
    // 暂存之前的交互interactions，用于之后恢复
    // 设置当前值__interactionsRef.current为root.memoizedInteractions
    const prevInteractions = pushInteractions(root);

    // Reset this to null before calling lifecycles
    // 在调用生命周期之前将ReactCurrentOwner.current设为null
    ReactCurrentOwner.current = null;

    // The commit phase is broken into several sub-phases. We do a separate pass
    // of the effect list for each phase: all mutation effects come before all
    // layout effects, and so on.
    // 提交阶段分为几个子阶段，每个阶段都会做单独的遍历effect list
    // mutation effects总是在layout effects之前

    // The first phase a "before mutation" phase. We use this phase to read the
    // state of the host tree right before we mutate it. This is where
    // getSnapshotBeforeUpdate is called.
    // 第一个阶段是before mutation
    // 这个阶段会在mutate之后读取host tree的状态，这里会调用getSnapshotBeforeUpdate

    // ???
    focusedInstanceHandle = prepareForCommit(root.containerInfo);
    shouldFireAfterActiveInstanceBlur = false;

    // 将firstEffect设为nextEffect
    nextEffect = firstEffect;
    // 第一个阶段before mutation
    // 遍历effect list处理删除副作用 需要加载显示的suspense组件 Snapshot副作用 Passive副作用
    do {
      if (__DEV__) {
        invokeGuardedCallback(null, commitBeforeMutationEffects, null);
        if (hasCaughtError()) {
          invariant(nextEffect !== null, 'Should be working on an effect.');
          const error = clearCaughtError();
          captureCommitPhaseError(nextEffect, error);
          nextEffect = nextEffect.nextEffect;
        }
      } else {
        try {
          // 第一个阶段before mutation
          // 遍历effect list处理删除副作用 需要加载显示的suspense组件 Snapshot副作用 Passive副作用
          commitBeforeMutationEffects();
        } catch (error) {
          invariant(nextEffect !== null, 'Should be working on an effect.');
          captureCommitPhaseError(nextEffect, error);
          nextEffect = nextEffect.nextEffect;
        }
      }
    } while (nextEffect !== null);

    // We no longer need to track the active instance fiber
    // 不需要active instance fiber，重置为null
    focusedInstanceHandle = null;

    // 记录commitTime
    if (enableProfilerTimer) {
      // Mark the current commit time to be shared by all Profilers in this
      // batch. This enables them to be grouped later.
      recordCommitTime();
    }

    // The next phase is the mutation phase, where we mutate the host tree.
    // 第二个阶段mutation，这里mutate host tree
    // 遍历effect list，处理ContentReset Ref Placement Update Deletion Hydrating副作用
    // 这里保留ContentReset和Ref，删除Placement Update Deletion Hydrating
    nextEffect = firstEffect;
    do {
      if (__DEV__) {
        invokeGuardedCallback(
          null,
          commitMutationEffects,
          null,
          root,
          renderPriorityLevel,
        );
        if (hasCaughtError()) {
          invariant(nextEffect !== null, 'Should be working on an effect.');
          const error = clearCaughtError();
          captureCommitPhaseError(nextEffect, error);
          nextEffect = nextEffect.nextEffect;
        }
      } else {
        try {
          // 第二个阶段mutation
          // 遍历effect list，处理ContentReset Ref Placement Update Deletion Hydrating副作用
          // 这里保留ContentReset和Ref，删除Placement Update Deletion Hydrating
          // 这里会调用componentWillUnmount，以及useEffect的返回值函数
          commitMutationEffects(root, renderPriorityLevel);
        } catch (error) {
          invariant(nextEffect !== null, 'Should be working on an effect.');
          captureCommitPhaseError(nextEffect, error);
          nextEffect = nextEffect.nextEffect;
        }
      }
    } while (nextEffect !== null);

    // selectionInformation.focusedElem触发afterblur事件
    if (shouldFireAfterActiveInstanceBlur) {
      afterActiveInstanceBlur();
    }
    resetAfterCommit(root.containerInfo);

    // The work-in-progress tree is now the current tree. This must come after
    // the mutation phase, so that the previous tree is still current during
    // componentWillUnmount, but before the layout phase, so that the finished
    // work is current during componentDidMount/Update.
    // before mutation和mutation阶段fiberRoot.current指向老的rootFiber
    //    在componentWillUnmount中可以访问到老的rootFiber
    // mutation阶段过后将fiberRoot.current指向finishedWork
    //    在componentDidMount/Update中可以访问到新的finishedWork
    root.current = finishedWork;

    // The next phase is the layout phase, where we call effects that read
    // the host tree after it's been mutated. The idiomatic use case for this is
    // layout, but class component lifecycles also fire here for legacy reasons.
    // 第三个阶段layout
    // 遍历effect list
    //    触发componentDidMount或componentDidUpdate
    //    清空updateQueue以其所有effect的callback
    //    触发自动聚焦autoFocus
    nextEffect = firstEffect;
    do {
      if (__DEV__) {
        invokeGuardedCallback(null, commitLayoutEffects, null, root, lanes);
        if (hasCaughtError()) {
          invariant(nextEffect !== null, 'Should be working on an effect.');
          const error = clearCaughtError();
          captureCommitPhaseError(nextEffect, error);
          nextEffect = nextEffect.nextEffect;
        }
      } else {
        try {
          // 第三个阶段layout
          // 遍历effect list
          //    触发componentDidMount或componentDidUpdate
          //    清空updateQueue以其所有effect的callback
          //    触发自动聚焦autoFocus
          //    执行useEffect副作用回调，将返回值函数作为destroy，在卸载组件时调用destroy
          commitLayoutEffects(root, lanes);
        } catch (error) {
          invariant(nextEffect !== null, 'Should be working on an effect.');
          captureCommitPhaseError(nextEffect, error);
          nextEffect = nextEffect.nextEffect;
        }
      }
    } while (nextEffect !== null);

    nextEffect = null;

    // Tell Scheduler to yield at the end of the frame, so the browser has an
    // opportunity to paint.
    // 在这一帧结束停止调度，浏览器就可以开始paint页面了
    // 设置needsPaint为true，表示需要浏览器绘制页面
    // 会在下一次调用shouldYieldToHost(workLoopConcurrent内部循环判断)，
    // 也就是当前帧超时之后，react会中断更新，通过port.postMessage提交一个新的宏任务，这个宏任务用于触发下一个时间分片的更新
    // 这个宏任务会在 下一帧浏览器执行完自己工作之后(这里包括浏览器的页面绘制，也就是绘制这里effect list产生的副作用) 执行
    requestPaint();

    // 恢复之前的交互interactions
    if (enableSchedulerTracing) {
      popInteractions(((prevInteractions: any): Set<Interaction>));
    }
    // 恢复之前的执行上下文
    executionContext = prevExecutionContext;

    // 恢复之前的更新优先级
    if (decoupleUpdatePriorityFromScheduler && previousLanePriority != null) {
      // Reset the priority to the previous non-sync value.
      setCurrentUpdateLanePriority(previousLanePriority);
    }
  } else {
    // No effects.
    // 没有effects，不需要更新
    // 直接将fiberRoot.current指向新的finishedWork

    // fiberRoot.current指向新的finishedWork
    root.current = finishedWork;
    // Measure these anyway so the flamegraph explicitly shows that there were
    // no effects.
    // TODO: Maybe there's a better way to report this.
    // 记录commit时间，便于火焰图显示这里没有effects
    if (enableProfilerTimer) {
      recordCommitTime();
    }
  }

  const rootDidHavePassiveEffects = rootDoesHavePassiveEffects;

  if (rootDoesHavePassiveEffects) {
    // This commit has passive effects. Stash a reference to them. But don't
    // schedule a callback until after flushing layout work.
    // 处理passive副作用，做好引用，在flushing layout work中调度

    rootDoesHavePassiveEffects = false;
    rootWithPendingPassiveEffects = root;
    pendingPassiveEffectsLanes = lanes;
    pendingPassiveEffectsRenderPriority = renderPriorityLevel;
  } else {
    // We are done with the effect chain at this point so let's clear the
    // nextEffect pointers to assist with GC. If we have passive effects, we'll
    // clear this in flushPassiveEffects.
    // 如果有passive副作用，这步操作将在flushPassiveEffects中执行

    nextEffect = firstEffect;
    // 遍历effect list，对需要删除副作用的effect清空sibling和stateNode
    while (nextEffect !== null) {
      const nextNextEffect = nextEffect.nextEffect;
      nextEffect.nextEffect = null;
      if (nextEffect.flags & Deletion) {
        detachFiberAfterEffects(nextEffect);
      }
      nextEffect = nextNextEffect;
    }
  }

  // Read this again, since an effect might have updated it
  remainingLanes = root.pendingLanes;

  // Check if there's remaining work on this root
  if (remainingLanes !== NoLanes) {
    // 有remainingLanes

    if (enableSchedulerTracing) {
      if (spawnedWorkDuringRender !== null) {
        const expirationTimes = spawnedWorkDuringRender;
        spawnedWorkDuringRender = null;
        for (let i = 0; i < expirationTimes.length; i++) {
          // 更新interaction的__count以及fiberRoot.pendingInteractionMap
          scheduleInteractions(
            root,
            expirationTimes[i],
            root.memoizedInteractions,
          );
        }
      }
      // 更新interaction的__count以及pendingInteractionMap
      schedulePendingInteractions(root, remainingLanes);
    }
  } else {
    // If there's no remaining work, we can clear the set of already failed
    // error boundaries.
    //  没有remainingLanes

    legacyErrorBoundariesThatAlreadyFailed = null;
  }

  if (enableSchedulerTracing) {
    if (!rootDidHavePassiveEffects) {
      // If there are no passive effects, then we can complete the pending interactions.
      // Otherwise, we'll wait until after the passive effects are flushed.
      // Wait to do this until after remaining work has been scheduled,
      // so that we don't prematurely signal complete for interactions when there's e.g. hidden work.
      // 没有passive副作用，就直接完成pending interactions，否则等到flush完passive effects之后

      // 完成FfiberRoot.pendingInteractionMap中的所有scheduledInteractions
      finishPendingInteractions(root, lanes);
    }
  }

  if (remainingLanes === SyncLane) {
    // Count the number of times the root synchronously re-renders without
    // finishing. If there are too many, it indicates an infinite update loop.
    //  计算未完成的同步渲染的次数，如果太多，表示无限更新循环

    if (root === rootWithNestedUpdates) {
      nestedUpdateCount++;
    } else {
      nestedUpdateCount = 0;
      rootWithNestedUpdates = root;
    }
  } else {
    nestedUpdateCount = 0;
  }

  onCommitRootDevTools(finishedWork.stateNode, renderPriorityLevel);

  if (__DEV__) {
    onCommitRootTestSelector();
  }

  // Always call this before exiting `commitRoot`, to ensure that any
  // additional work on this root is scheduled.
  // 在退出commitRoot之前总是执行ensureRootIsScheduled，检查是否有额外的工作被调度了
  // 最后添加的rootWithPendingPassiveEffects是不是在这里调度执行flushPassiveEffects???
  // 依赖项改变的useEffect副作用函数在这里调度处理，在flushPassiveEffects中执行
  // 这里useEffect的依赖项一定不变，所以不会触发无限循环的调度ensureRootIsScheduled
  ensureRootIsScheduled(root, now());

  // 有错误
  if (hasUncaughtError) {
    hasUncaughtError = false;
    const error = firstUncaughtError;
    firstUncaughtError = null;
    throw error;
  }

  // 当前执行上下文为LegacyUnbatchedContext
  if ((executionContext & LegacyUnbatchedContext) !== NoContext) {
    if (__DEV__) {
      if (enableDebugTracing) {
        logCommitStopped();
      }
    }

    // 标记commit结束
    if (enableSchedulingProfiler) {
      markCommitStopped();
    }

    // This is a legacy edge case. We just committed the initial mount of
    // a ReactDOM.render-ed root inside of batchedUpdates. The commit fired
    // synchronously, but layout updates should be deferred until the end
    // of the batch.
    return null;
  }

  // If layout work was scheduled, flush it now.
  // 如果有layout工作被调度了，在这里flush
  flushSyncCallbackQueue();

  if (__DEV__) {
    if (enableDebugTracing) {
      logCommitStopped();
    }
  }

  // 标记commit结束
  if (enableSchedulingProfiler) {
    markCommitStopped();
  }

  return null;
}

// 第一个阶段before mutation
// 遍历effect list处理删除副作用 需要加载显示的suspense组件 Snapshot副作用 Passive副作用
function commitBeforeMutationEffects() {
  while (nextEffect !== null) {
    // nextEffect对应的currentFiber
    const current = nextEffect.alternate;

    // 处理删除副作用和需要加载显示的suspense组件
    if (!shouldFireAfterActiveInstanceBlur && focusedInstanceHandle !== null) {
      if ((nextEffect.flags & Deletion) !== NoFlags) {
        // 需要做删除副作用

        // nextEffect是否是focusedInstanceHandle或其父或其祖先
        if (doesFiberContain(nextEffect, focusedInstanceHandle)) {
          shouldFireAfterActiveInstanceBlur = true;
          // selectionInformation.focusedElem触发beforeblur事件
          beforeActiveInstanceBlur(nextEffect);
        }
      } else {
        // TODO: Move this out of the hot path using a dedicated effect tag.
        if (
          // suspense组件
          nextEffect.tag === SuspenseComponent &&
          // suspense组件是否显示
          // true为显示 false为隐藏
          isSuspenseBoundaryBeingHidden(current, nextEffect) &&
          // nextEffect是否是focusedInstanceHandle或其父或其祖先
          doesFiberContain(nextEffect, focusedInstanceHandle)
        ) {
          // 需要加载显示的suspense组件
          shouldFireAfterActiveInstanceBlur = true;
          // selectionInformation.focusedElem触发beforeblur事件
          beforeActiveInstanceBlur(nextEffect);
        }
      }
    }

    const flags = nextEffect.flags;
    // 处理Snapshot副作用
    if ((flags & Snapshot) !== NoFlags) {
      setCurrentDebugFiberInDEV(nextEffect);

      commitBeforeMutationEffectOnFiber(current, nextEffect);

      resetCurrentDebugFiberInDEV();
    }
    // 处理Passive副作用
    if ((flags & Passive) !== NoFlags) {
      // If there are passive effects, schedule a callback to flush at
      // the earliest opportunity.
      if (!rootDoesHavePassiveEffects) {
        rootDoesHavePassiveEffects = true;
        // 根据优先级调度callback，返回newTask
        scheduleCallback(NormalSchedulerPriority, () => {
          flushPassiveEffects();
          return null;
        });
      }
    }
    // 下一个effect
    nextEffect = nextEffect.nextEffect;
  }
}

// 第二阶段mutation
// 遍历effect list，处理ContentReset Ref Placement Update Deletion Hydrating副作用
// 这里保留ContentReset和Ref，删除Placement Update Deletion Hydrating
// 这里会调用componentWillUnmount，以及useEffect的返回值函数
function commitMutationEffects(
  root: FiberRoot,
  renderPriorityLevel: ReactPriorityLevel,
) {
  // TODO: Should probably move the bulk of this function to commitWork.
  // 这里很有可能转到commitWork

  // 遍历effect list，处理ContentReset Ref Placement Update Deletion Hydrating副作用
  // 这里保留ContentReset和Ref，删除Placement Update Deletion Hydrating
  while (nextEffect !== null) {
    setCurrentDebugFiberInDEV(nextEffect);

    const flags = nextEffect.flags;

    // 处理ContentReset副作用
    if (flags & ContentReset) {
      // 重置nextEffect.stateNode的文本为''
      commitResetTextContent(nextEffect);
    }

    // 处理Ref副作用
    // 更新ref并记录其layout effect时间
    if (flags & Ref) {
      // currentFiber
      const current = nextEffect.alternate;
      if (current !== null) {
        // 重置ref.current指向为null，或是给ref回调传入null重置
        commitDetachRef(current);
      }
      if (enableScopeAPI) {
        // TODO: This is a temporary solution that allowed us to transition away
        // from React Flare on www.
        if (nextEffect.tag === ScopeComponent) {
          // ref.current指向为最新dom instance，或是给ref回调传入最新dom instance
          commitAttachRef(nextEffect);
        }
      }
    }

    // The following switch statement is only concerned about placement,
    // updates, and deletions. To avoid needing to add a case for every possible
    // bitmap value, we remove the secondary effects from the effect tag and
    // switch on that value.
    // 只关注Placement Update Deletion Hydrating这四个副作用
    // 处理完均在nextEffect.flags移除对应的副作用flag
    const primaryFlags = flags & (Placement | Update | Deletion | Hydrating);
    switch (primaryFlags) {
      case Placement: {
        // 处理Placement副作用

        // 将nextEffect对应的dom插入到dom结构中的对应位置
        commitPlacement(nextEffect);
        // Clear the "placement" from effect tag so that we know that this is
        // inserted, before any life-cycles like componentDidMount gets called.
        // TODO: findDOMNode doesn't rely on this any more but isMounted does
        // and isMounted is deprecated anyway so we should be able to kill this.
        nextEffect.flags &= ~Placement;
        break;
      }
      case PlacementAndUpdate: {
        // Placement
        // 处理Placement和Update副作用

        // 将nextEffect对应的dom插入到dom结构中的对应位置
        commitPlacement(nextEffect);
        // Clear the "placement" from effect tag so that we know that this is
        // inserted, before any life-cycles like componentDidMount gets called.
        nextEffect.flags &= ~Placement;

        // Update
        // nextEffect对应的currentFiber
        const current = nextEffect.alternate;
        // 做 销毁 显示/隐藏 更新container 更新dom(根据diff的结构updatePayload) 更新dom文本 的操作
        commitWork(current, nextEffect);
        break;
      }
      case Hydrating: {
        // 处理Hydrating副作用，直接移除
        nextEffect.flags &= ~Hydrating;
        break;
      }
      case HydratingAndUpdate: {
        // 处理Hydrating和Update副作用
        // 移除Hydrating标志
        nextEffect.flags &= ~Hydrating;

        // Update
        const current = nextEffect.alternate;
        // 做 销毁 显示/隐藏 更新container 更新dom(根据diff的结构updatePayload) 更新dom文本 的操作
        commitWork(current, nextEffect);
        break;
      }
      case Update: {
        const current = nextEffect.alternate;
        // 做 销毁 显示/隐藏 更新container 更新dom(根据diff的结构updatePayload) 更新dom文本 的操作
        commitWork(current, nextEffect);
        break;
      }
      case Deletion: {
        // 处理Deletion副作用
        // 提交删除，对current及其children(这也可能还有sibling)做卸载，移除dom结构
        // 这里会调用componentWillUnmount，以及useEffect的返回值函数
        // 最后重置nextEffect及其对应的currentFiber
        commitDeletion(root, nextEffect, renderPriorityLevel);
        break;
      }
    }

    resetCurrentDebugFiberInDEV();
    // 下一个effect
    nextEffect = nextEffect.nextEffect;
  }
}

// 第三个阶段layout
// 遍历effect list
//    触发componentDidMount或componentDidUpdate
//    清空updateQueue以其所有effect的callback
//    触发自动聚焦autoFocus
//    执行useEffect副作用回调，将返回值函数作为destroy，在卸载组件时调用destroy
function commitLayoutEffects(root: FiberRoot, committedLanes: Lanes) {
  if (__DEV__) {
    if (enableDebugTracing) {
      logLayoutEffectsStarted(committedLanes);
    }
  }

  // 标记layout effects开始
  if (enableSchedulingProfiler) {
    markLayoutEffectsStarted(committedLanes);
  }

  // TODO: Should probably move the bulk of this function to commitWork.
  while (nextEffect !== null) {
    setCurrentDebugFiberInDEV(nextEffect);

    const flags = nextEffect.flags;

    // 处理Update和Callback副作用
    if (flags & (Update | Callback)) {
      const current = nextEffect.alternate;
      // 提交生命周期
      // 触发componentDidMount或componentDidUpdate
      // 清空updateQueue以其所有effect的callback
      // 触发自动聚焦autoFocus
      // 执行useEffect副作用回调，将返回值函数作为destroy，在卸载组件时调用destroy
      commitLayoutEffectOnFiber(root, current, nextEffect, committedLanes);
    }

    // 处理ref副作用
    // ref.current指向为最新dom instance，或是给ref回调传入最新dom instance
    if (enableScopeAPI) {
      // TODO: This is a temporary solution that allowed us to transition away
      // from React Flare on www.
      if (flags & Ref && nextEffect.tag !== ScopeComponent) {
        commitAttachRef(nextEffect);
      }
    } else {
      if (flags & Ref) {
        commitAttachRef(nextEffect);
      }
    }

    resetCurrentDebugFiberInDEV();
    nextEffect = nextEffect.nextEffect;
  }

  if (__DEV__) {
    if (enableDebugTracing) {
      logLayoutEffectsStopped();
    }
  }

  // 标记layout effects结束
  if (enableSchedulingProfiler) {
    markLayoutEffectsStopped();
  }
}

// 这个函数什么时候调用???
// 这个函数处理依赖项变化的useEffect副作用回调???
// 清除脏作用，什么意思???
export function flushPassiveEffects(): boolean {
  // Returns whether passive effects were flushed.
  if (pendingPassiveEffectsRenderPriority !== NoSchedulerPriority) {
    const priorityLevel =
      pendingPassiveEffectsRenderPriority > NormalSchedulerPriority
        ? NormalSchedulerPriority
        : pendingPassiveEffectsRenderPriority;
    pendingPassiveEffectsRenderPriority = NoSchedulerPriority;
    if (decoupleUpdatePriorityFromScheduler) {
      const previousLanePriority = getCurrentUpdateLanePriority();
      try {
        setCurrentUpdateLanePriority(
          schedulerPriorityToLanePriority(priorityLevel),
        );
        return runWithPriority(priorityLevel, flushPassiveEffectsImpl);
      } finally {
        setCurrentUpdateLanePriority(previousLanePriority);
      }
    } else {
      // 设置最新的优先级，然后执行flushPassiveEffectsImpl
      return runWithPriority(priorityLevel, flushPassiveEffectsImpl);
    }
  }
  return false;
}

export function enqueuePendingPassiveProfilerEffect(fiber: Fiber): void {
  if (enableProfilerTimer && enableProfilerCommitHooks) {
    pendingPassiveProfilerEffects.push(fiber);
    if (!rootDoesHavePassiveEffects) {
      rootDoesHavePassiveEffects = true;
      scheduleCallback(NormalSchedulerPriority, () => {
        flushPassiveEffects();
        return null;
      });
    }
  }
}

export function enqueuePendingPassiveHookEffectMount(
  fiber: Fiber,
  effect: HookEffect,
): void {
  pendingPassiveHookEffectsMount.push(effect, fiber);
  if (!rootDoesHavePassiveEffects) {
    rootDoesHavePassiveEffects = true;
    scheduleCallback(NormalSchedulerPriority, () => {
      flushPassiveEffects();
      return null;
    });
  }
}

export function enqueuePendingPassiveHookEffectUnmount(
  fiber: Fiber,
  effect: HookEffect,
): void {
  pendingPassiveHookEffectsUnmount.push(effect, fiber);
  if (__DEV__) {
    fiber.flags |= PassiveUnmountPendingDev;
    const alternate = fiber.alternate;
    if (alternate !== null) {
      alternate.flags |= PassiveUnmountPendingDev;
    }
  }
  if (!rootDoesHavePassiveEffects) {
    rootDoesHavePassiveEffects = true;
    scheduleCallback(NormalSchedulerPriority, () => {
      flushPassiveEffects();
      return null;
    });
  }
}

function invokePassiveEffectCreate(effect: HookEffect): void {
  const create = effect.create;
  effect.destroy = create();
}

// flushPassiveEffects的内部函数
// 第一步，销毁老的passive effects
//    遍历pendingPassiveHookEffectsUnmount，执行每一个effect的destroy方法，并将effect.destroy重置为undefined
// 第二步，创建新的passive effects
//    遍历pendingPassiveHookEffectsMount，执行每一个effect的create方法，并将返回值给到destroy，用于后续销毁
// 第三步，处理自身rootFiber对应的effect list中的deletion副作用
function flushPassiveEffectsImpl() {
  // 没有passiveEffects的fiberRoot，直接返回false
  if (rootWithPendingPassiveEffects === null) {
    return false;
  }

  const root = rootWithPendingPassiveEffects;
  const lanes = pendingPassiveEffectsLanes;
  // 取完rootWithPendingPassiveEffects和pendingPassiveEffectsLanes后将其重置清空
  rootWithPendingPassiveEffects = null;
  pendingPassiveEffectsLanes = NoLanes;

  invariant(
    (executionContext & (RenderContext | CommitContext)) === NoContext,
    'Cannot flush passive effects while already rendering.',
  );

  if (__DEV__) {
    if (enableDebugTracing) {
      logPassiveEffectsStarted(lanes);
    }
  }

  // 标记passive-effects-start
  if (enableSchedulingProfiler) {
    markPassiveEffectsStarted(lanes);
  }

  if (__DEV__) {
    isFlushingPassiveEffects = true;
  }

  // 暂存之前的执行上下文和交互，用于结束后的恢复
  const prevExecutionContext = executionContext;
  executionContext |= CommitContext;
  const prevInteractions = pushInteractions(root);

  // It's important that ALL pending passive effect destroy functions are called
  // before ANY passive effect create functions are called.
  // Otherwise effects in sibling components might interfere with each other.
  // e.g. a destroy function in one component may unintentionally override a ref
  // value set by a create function in another component.
  // Layout effects have the same constraint.
  // 所有pending passive effect destroy functions必须先于任何passive effect create functions，否则会互相干扰

  // First pass: Destroy stale passive effects.
  // 第一步，销毁老的passive effects
  const unmountEffects = pendingPassiveHookEffectsUnmount;
  pendingPassiveHookEffectsUnmount = [];
  // 遍历pendingPassiveHookEffectsUnmount，执行每一个effect的destroy方法，并将effect.destroy重置为undefined
  for (let i = 0; i < unmountEffects.length; i += 2) {
    const effect = ((unmountEffects[i]: any): HookEffect);
    const fiber = ((unmountEffects[i + 1]: any): Fiber);
    const destroy = effect.destroy;
    effect.destroy = undefined;

    if (__DEV__) {
      fiber.flags &= ~PassiveUnmountPendingDev;
      const alternate = fiber.alternate;
      if (alternate !== null) {
        alternate.flags &= ~PassiveUnmountPendingDev;
      }
    }

    if (typeof destroy === 'function') {
      if (__DEV__) {
        setCurrentDebugFiberInDEV(fiber);
        if (
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          fiber.mode & ProfileMode
        ) {
          startPassiveEffectTimer();
          invokeGuardedCallback(null, destroy, null);
          recordPassiveEffectDuration(fiber);
        } else {
          invokeGuardedCallback(null, destroy, null);
        }
        if (hasCaughtError()) {
          invariant(fiber !== null, 'Should be working on an effect.');
          const error = clearCaughtError();
          captureCommitPhaseError(fiber, error);
        }
        resetCurrentDebugFiberInDEV();
      } else {
        try {
          if (
            enableProfilerTimer &&
            enableProfilerCommitHooks &&
            fiber.mode & ProfileMode
          ) {
            // 记录passive effect的持续时间
            // 执行destroy
            try {
              startPassiveEffectTimer();
              destroy();
            } finally {
              recordPassiveEffectDuration(fiber);
            }
          } else {
            // 执行destroy
            destroy();
          }
        } catch (error) {
          invariant(fiber !== null, 'Should be working on an effect.');
          captureCommitPhaseError(fiber, error);
        }
      }
    }
  }
  // Second pass: Create new passive effects.
  // 第二步，创建新的passive effects
  const mountEffects = pendingPassiveHookEffectsMount;
  pendingPassiveHookEffectsMount = [];
  // 遍历pendingPassiveHookEffectsMount，执行每一个effect的create方法，并将返回值给到destroy，用于后续销毁
  for (let i = 0; i < mountEffects.length; i += 2) {
    const effect = ((mountEffects[i]: any): HookEffect);
    const fiber = ((mountEffects[i + 1]: any): Fiber);
    if (__DEV__) {
      setCurrentDebugFiberInDEV(fiber);
      if (
        enableProfilerTimer &&
        enableProfilerCommitHooks &&
        fiber.mode & ProfileMode
      ) {
        startPassiveEffectTimer();
        invokeGuardedCallback(null, invokePassiveEffectCreate, null, effect);
        recordPassiveEffectDuration(fiber);
      } else {
        invokeGuardedCallback(null, invokePassiveEffectCreate, null, effect);
      }
      if (hasCaughtError()) {
        invariant(fiber !== null, 'Should be working on an effect.');
        const error = clearCaughtError();
        captureCommitPhaseError(fiber, error);
      }
      resetCurrentDebugFiberInDEV();
    } else {
      try {
        const create = effect.create;
        if (
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          fiber.mode & ProfileMode
        ) {
          try {
            // 记录passive effect持续时间
            // 执行create方法，返回值为destroy，用于后续销毁
            startPassiveEffectTimer();
            effect.destroy = create();
          } finally {
            recordPassiveEffectDuration(fiber);
          }
        } else {
          // 执行create方法，返回值为destroy，用于后续销毁
          effect.destroy = create();
        }
      } catch (error) {
        invariant(fiber !== null, 'Should be working on an effect.');
        captureCommitPhaseError(fiber, error);
      }
    }
  }

  // Note: This currently assumes there are no passive effects on the root fiber
  // because the root is not part of its own effect list.
  // This could change in the future.
  // 这里已经没有passive effects，但是还有root自身的

  // root.current指向rootFiber
  // 处理rootFiber对应的effect list中的deletion副作用
  let effect = root.current.firstEffect;
  while (effect !== null) {
    const nextNextEffect = effect.nextEffect;
    // Remove nextEffect pointer to assist GC
    effect.nextEffect = null;
    // 处理effect的deletion副作用
    if (effect.flags & Deletion) {
      // 清空effect的siblng和stateNode
      detachFiberAfterEffects(effect);
    }
    effect = nextNextEffect;
  }

  // 遍历pendingPassiveProfilerEffects，对每个fiber提交passive effect持续时间
  if (enableProfilerTimer && enableProfilerCommitHooks) {
    const profilerEffects = pendingPassiveProfilerEffects;
    pendingPassiveProfilerEffects = [];
    for (let i = 0; i < profilerEffects.length; i++) {
      const fiber = ((profilerEffects[i]: any): Fiber);
      commitPassiveEffectDurations(root, fiber);
    }
  }

  // 恢复交互
  if (enableSchedulerTracing) {
    popInteractions(((prevInteractions: any): Set<Interaction>));
    finishPendingInteractions(root, lanes);
  }

  if (__DEV__) {
    isFlushingPassiveEffects = false;
  }

  if (__DEV__) {
    if (enableDebugTracing) {
      logPassiveEffectsStopped();
    }
  }

  // 标记passive-effects-stop
  if (enableSchedulingProfiler) {
    markPassiveEffectsStopped();
  }

  // 恢复执行上下文
  executionContext = prevExecutionContext;

  flushSyncCallbackQueue();

  // If additional passive effects were scheduled, increment a counter. If this
  // exceeds the limit, we'll fire a warning.
  // 没有passive effects的fiberRoot，则清空计数
  // 否则，每加一个passive effect，就增加一个计数，当计数达到阈值，就报错
  nestedPassiveUpdateCount =
    rootWithPendingPassiveEffects === null ? 0 : nestedPassiveUpdateCount + 1;

  // 完成，返回true
  return true;
}

export function isAlreadyFailedLegacyErrorBoundary(instance: mixed): boolean {
  return (
    legacyErrorBoundariesThatAlreadyFailed !== null &&
    legacyErrorBoundariesThatAlreadyFailed.has(instance)
  );
}

export function markLegacyErrorBoundaryAsFailed(instance: mixed) {
  if (legacyErrorBoundariesThatAlreadyFailed === null) {
    legacyErrorBoundariesThatAlreadyFailed = new Set([instance]);
  } else {
    legacyErrorBoundariesThatAlreadyFailed.add(instance);
  }
}

function prepareToThrowUncaughtError(error: mixed) {
  if (!hasUncaughtError) {
    hasUncaughtError = true;
    firstUncaughtError = error;
  }
}
export const onUncaughtError = prepareToThrowUncaughtError;

function captureCommitPhaseErrorOnRoot(
  rootFiber: Fiber,
  sourceFiber: Fiber,
  error: mixed,
) {
  const errorInfo = createCapturedValue(error, sourceFiber);
  const update = createRootErrorUpdate(rootFiber, errorInfo, (SyncLane: Lane));
  enqueueUpdate(rootFiber, update);
  const eventTime = requestEventTime();
  const root = markUpdateLaneFromFiberToRoot(rootFiber, (SyncLane: Lane));
  if (root !== null) {
    markRootUpdated(root, SyncLane, eventTime);
    ensureRootIsScheduled(root, eventTime);
    schedulePendingInteractions(root, SyncLane);
  }
}

export function captureCommitPhaseError(sourceFiber: Fiber, error: mixed) {
  if (sourceFiber.tag === HostRoot) {
    // Error was thrown at the root. There is no parent, so the root
    // itself should capture it.
    captureCommitPhaseErrorOnRoot(sourceFiber, sourceFiber, error);
    return;
  }

  let fiber = sourceFiber.return;

  while (fiber !== null) {
    if (fiber.tag === HostRoot) {
      captureCommitPhaseErrorOnRoot(fiber, sourceFiber, error);
      return;
    } else if (fiber.tag === ClassComponent) {
      const ctor = fiber.type;
      const instance = fiber.stateNode;
      if (
        typeof ctor.getDerivedStateFromError === 'function' ||
        (typeof instance.componentDidCatch === 'function' &&
          !isAlreadyFailedLegacyErrorBoundary(instance))
      ) {
        const errorInfo = createCapturedValue(error, sourceFiber);
        const update = createClassErrorUpdate(
          fiber,
          errorInfo,
          (SyncLane: Lane),
        );
        enqueueUpdate(fiber, update);
        const eventTime = requestEventTime();
        const root = markUpdateLaneFromFiberToRoot(fiber, (SyncLane: Lane));
        if (root !== null) {
          markRootUpdated(root, SyncLane, eventTime);
          ensureRootIsScheduled(root, eventTime);
          schedulePendingInteractions(root, SyncLane);
        } else {
          // This component has already been unmounted.
          // We can't schedule any follow up work for the root because the fiber is already unmounted,
          // but we can still call the log-only boundary so the error isn't swallowed.
          //
          // TODO This is only a temporary bandaid for the old reconciler fork.
          // We can delete this special case once the new fork is merged.
          if (
            typeof instance.componentDidCatch === 'function' &&
            !isAlreadyFailedLegacyErrorBoundary(instance)
          ) {
            try {
              instance.componentDidCatch(error, errorInfo);
            } catch (errorToIgnore) {
              // TODO Ignore this error? Rethrow it?
              // This is kind of an edge case.
            }
          }
        }
        return;
      }
    }
    fiber = fiber.return;
  }
}

export function pingSuspendedRoot(
  root: FiberRoot,
  wakeable: Wakeable,
  pingedLanes: Lanes,
) {
  const pingCache = root.pingCache;
  if (pingCache !== null) {
    // The wakeable resolved, so we no longer need to memoize, because it will
    // never be thrown again.
    pingCache.delete(wakeable);
  }

  const eventTime = requestEventTime();
  markRootPinged(root, pingedLanes, eventTime);

  if (
    workInProgressRoot === root &&
    isSubsetOfLanes(workInProgressRootRenderLanes, pingedLanes)
  ) {
    // Received a ping at the same priority level at which we're currently
    // rendering. We might want to restart this render. This should mirror
    // the logic of whether or not a root suspends once it completes.

    // TODO: If we're rendering sync either due to Sync, Batched or expired,
    // we should probably never restart.

    // If we're suspended with delay, or if it's a retry, we'll always suspend
    // so we can always restart.
    if (
      workInProgressRootExitStatus === RootSuspendedWithDelay ||
      (workInProgressRootExitStatus === RootSuspended &&
        includesOnlyRetries(workInProgressRootRenderLanes) &&
        now() - globalMostRecentFallbackTime < FALLBACK_THROTTLE_MS)
    ) {
      // Restart from the root.
      prepareFreshStack(root, NoLanes);
    } else {
      // Even though we can't restart right now, we might get an
      // opportunity later. So we mark this render as having a ping.
      workInProgressRootPingedLanes = mergeLanes(
        workInProgressRootPingedLanes,
        pingedLanes,
      );
    }
  }

  ensureRootIsScheduled(root, eventTime);
  schedulePendingInteractions(root, pingedLanes);
}

function retryTimedOutBoundary(boundaryFiber: Fiber, retryLane: Lane) {
  // The boundary fiber (a Suspense component or SuspenseList component)
  // previously was rendered in its fallback state. One of the promises that
  // suspended it has resolved, which means at least part of the tree was
  // likely unblocked. Try rendering again, at a new expiration time.
  if (retryLane === NoLane) {
    retryLane = requestRetryLane(boundaryFiber);
  }
  // TODO: Special case idle priority?
  const eventTime = requestEventTime();
  const root = markUpdateLaneFromFiberToRoot(boundaryFiber, retryLane);
  if (root !== null) {
    markRootUpdated(root, retryLane, eventTime);
    ensureRootIsScheduled(root, eventTime);
    schedulePendingInteractions(root, retryLane);
  }
}

export function retryDehydratedSuspenseBoundary(boundaryFiber: Fiber) {
  const suspenseState: null | SuspenseState = boundaryFiber.memoizedState;
  let retryLane = NoLane;
  if (suspenseState !== null) {
    retryLane = suspenseState.retryLane;
  }
  retryTimedOutBoundary(boundaryFiber, retryLane);
}

export function resolveRetryWakeable(boundaryFiber: Fiber, wakeable: Wakeable) {
  let retryLane = NoLane; // Default
  let retryCache: WeakSet<Wakeable> | Set<Wakeable> | null;
  if (enableSuspenseServerRenderer) {
    switch (boundaryFiber.tag) {
      case SuspenseComponent:
        retryCache = boundaryFiber.stateNode;
        const suspenseState: null | SuspenseState = boundaryFiber.memoizedState;
        if (suspenseState !== null) {
          retryLane = suspenseState.retryLane;
        }
        break;
      case SuspenseListComponent:
        retryCache = boundaryFiber.stateNode;
        break;
      default:
        invariant(
          false,
          'Pinged unknown suspense boundary type. ' +
            'This is probably a bug in React.',
        );
    }
  } else {
    retryCache = boundaryFiber.stateNode;
  }

  if (retryCache !== null) {
    // The wakeable resolved, so we no longer need to memoize, because it will
    // never be thrown again.
    retryCache.delete(wakeable);
  }

  retryTimedOutBoundary(boundaryFiber, retryLane);
}

// Computes the next Just Noticeable Difference (JND) boundary.
// The theory is that a person can't tell the difference between small differences in time.
// Therefore, if we wait a bit longer than necessary that won't translate to a noticeable
// difference in the experience. However, waiting for longer might mean that we can avoid
// showing an intermediate loading state. The longer we have already waited, the harder it
// is to tell small differences in time. Therefore, the longer we've already waited,
// the longer we can wait additionally. At some point we have to give up though.
// We pick a train model where the next boundary commits at a consistent schedule.
// These particular numbers are vague estimates. We expect to adjust them based on research.
function jnd(timeElapsed: number) {
  return timeElapsed < 120
    ? 120
    : timeElapsed < 480
    ? 480
    : timeElapsed < 1080
    ? 1080
    : timeElapsed < 1920
    ? 1920
    : timeElapsed < 3000
    ? 3000
    : timeElapsed < 4320
    ? 4320
    : ceil(timeElapsed / 1960) * 1960;
}

// 检查update tasks的数量是否超过50个
function checkForNestedUpdates() {
  if (nestedUpdateCount > NESTED_UPDATE_LIMIT) {
    nestedUpdateCount = 0;
    rootWithNestedUpdates = null;
    // 如果超过规定数, 下面这段警告在实际开发中经常会遇到
    // 当然这种情况大多数都是React新手在编写含有setState的函数时候无限调用导致的
    invariant(
      false,
      'Maximum update depth exceeded. This can happen when a component ' +
        'repeatedly calls setState inside componentWillUpdate or ' +
        'componentDidUpdate. React limits the number of nested updates to ' +
        'prevent infinite loops.',
    );
  }

  if (__DEV__) {
    if (nestedPassiveUpdateCount > NESTED_PASSIVE_UPDATE_LIMIT) {
      nestedPassiveUpdateCount = 0;
      console.error(
        'Maximum update depth exceeded. This can happen when a component ' +
          "calls setState inside useEffect, but useEffect either doesn't " +
          'have a dependency array, or one of the dependencies changes on ' +
          'every render.',
      );
    }
  }
}

function flushRenderPhaseStrictModeWarningsInDEV() {
  if (__DEV__) {
    ReactStrictModeWarnings.flushLegacyContextWarning();

    if (warnAboutDeprecatedLifecycles) {
      ReactStrictModeWarnings.flushPendingUnsafeLifecycleWarnings();
    }
  }
}

let didWarnStateUpdateForNotYetMountedComponent: Set<string> | null = null;
function warnAboutUpdateOnNotYetMountedFiberInDEV(fiber) {
  if (__DEV__) {
    if ((executionContext & RenderContext) !== NoContext) {
      // We let the other warning about render phase updates deal with this one.
      return;
    }

    if (!(fiber.mode & (BlockingMode | ConcurrentMode))) {
      return;
    }

    const tag = fiber.tag;
    if (
      tag !== IndeterminateComponent &&
      tag !== HostRoot &&
      tag !== ClassComponent &&
      tag !== FunctionComponent &&
      tag !== ForwardRef &&
      tag !== MemoComponent &&
      tag !== SimpleMemoComponent &&
      tag !== Block
    ) {
      // Only warn for user-defined components, not internal ones like Suspense.
      return;
    }

    // We show the whole stack but dedupe on the top component's name because
    // the problematic code almost always lies inside that component.
    const componentName = getComponentName(fiber.type) || 'ReactComponent';
    if (didWarnStateUpdateForNotYetMountedComponent !== null) {
      if (didWarnStateUpdateForNotYetMountedComponent.has(componentName)) {
        return;
      }
      didWarnStateUpdateForNotYetMountedComponent.add(componentName);
    } else {
      didWarnStateUpdateForNotYetMountedComponent = new Set([componentName]);
    }

    const previousFiber = ReactCurrentFiberCurrent;
    try {
      setCurrentDebugFiberInDEV(fiber);
      console.error(
        "Can't perform a React state update on a component that hasn't mounted yet. " +
          'This indicates that you have a side-effect in your render function that ' +
          'asynchronously later calls tries to update the component. Move this work to ' +
          'useEffect instead.',
      );
    } finally {
      if (previousFiber) {
        setCurrentDebugFiberInDEV(fiber);
      } else {
        resetCurrentDebugFiberInDEV();
      }
    }
  }
}

let didWarnStateUpdateForUnmountedComponent: Set<string> | null = null;
function warnAboutUpdateOnUnmountedFiberInDEV(fiber) {
  if (__DEV__) {
    const tag = fiber.tag;
    if (
      tag !== HostRoot &&
      tag !== ClassComponent &&
      tag !== FunctionComponent &&
      tag !== ForwardRef &&
      tag !== MemoComponent &&
      tag !== SimpleMemoComponent &&
      tag !== Block
    ) {
      // Only warn for user-defined components, not internal ones like Suspense.
      return;
    }

    // If there are pending passive effects unmounts for this Fiber,
    // we can assume that they would have prevented this update.
    if ((fiber.flags & PassiveUnmountPendingDev) !== NoFlags) {
      return;
    }

    // We show the whole stack but dedupe on the top component's name because
    // the problematic code almost always lies inside that component.
    const componentName = getComponentName(fiber.type) || 'ReactComponent';
    if (didWarnStateUpdateForUnmountedComponent !== null) {
      if (didWarnStateUpdateForUnmountedComponent.has(componentName)) {
        return;
      }
      didWarnStateUpdateForUnmountedComponent.add(componentName);
    } else {
      didWarnStateUpdateForUnmountedComponent = new Set([componentName]);
    }

    if (isFlushingPassiveEffects) {
      // Do not warn if we are currently flushing passive effects!
      //
      // React can't directly detect a memory leak, but there are some clues that warn about one.
      // One of these clues is when an unmounted React component tries to update its state.
      // For example, if a component forgets to remove an event listener when unmounting,
      // that listener may be called later and try to update state,
      // at which point React would warn about the potential leak.
      //
      // Warning signals are the most useful when they're strong.
      // (So we should avoid false positive warnings.)
      // Updating state from within an effect cleanup function is sometimes a necessary pattern, e.g.:
      // 1. Updating an ancestor that a component had registered itself with on mount.
      // 2. Resetting state when a component is hidden after going offscreen.
    } else {
      const previousFiber = ReactCurrentFiberCurrent;
      try {
        setCurrentDebugFiberInDEV(fiber);
        console.error(
          "Can't perform a React state update on an unmounted component. This " +
            'is a no-op, but it indicates a memory leak in your application. To ' +
            'fix, cancel all subscriptions and asynchronous tasks in %s.',
          tag === ClassComponent
            ? 'the componentWillUnmount method'
            : 'a useEffect cleanup function',
        );
      } finally {
        if (previousFiber) {
          setCurrentDebugFiberInDEV(fiber);
        } else {
          resetCurrentDebugFiberInDEV();
        }
      }
    }
  }
}

let beginWork;
if (__DEV__ && replayFailedUnitOfWorkWithInvokeGuardedCallback) {
  const dummyFiber = null;
  beginWork = (current, unitOfWork, lanes) => {
    // If a component throws an error, we replay it again in a synchronously
    // dispatched event, so that the debugger will treat it as an uncaught
    // error See ReactErrorUtils for more information.

    // Before entering the begin phase, copy the work-in-progress onto a dummy
    // fiber. If beginWork throws, we'll use this to reset the state.
    const originalWorkInProgressCopy = assignFiberPropertiesInDEV(
      dummyFiber,
      unitOfWork,
    );
    try {
      return originalBeginWork(current, unitOfWork, lanes);
    } catch (originalError) {
      if (
        originalError !== null &&
        typeof originalError === 'object' &&
        typeof originalError.then === 'function'
      ) {
        // Don't replay promises. Treat everything else like an error.
        throw originalError;
      }

      // Keep this code in sync with handleError; any changes here must have
      // corresponding changes there.
      resetContextDependencies();
      resetHooksAfterThrow();
      // Don't reset current debug fiber, since we're about to work on the
      // same fiber again.

      // Unwind the failed stack frame
      unwindInterruptedWork(unitOfWork);

      // Restore the original properties of the fiber.
      assignFiberPropertiesInDEV(unitOfWork, originalWorkInProgressCopy);

      if (enableProfilerTimer && unitOfWork.mode & ProfileMode) {
        // Reset the profiler timer.
        startProfilerTimer(unitOfWork);
      }

      // Run beginWork again.
      invokeGuardedCallback(
        null,
        originalBeginWork,
        null,
        current,
        unitOfWork,
        lanes,
      );

      if (hasCaughtError()) {
        const replayError = clearCaughtError();
        // `invokeGuardedCallback` sometimes sets an expando `_suppressLogging`.
        // Rethrow this error instead of the original one.
        throw replayError;
      } else {
        // This branch is reachable if the render phase is impure.
        throw originalError;
      }
    }
  };
} else {
  beginWork = originalBeginWork;
}

let didWarnAboutUpdateInRender = false;
let didWarnAboutUpdateInRenderForAnotherComponent;
if (__DEV__) {
  didWarnAboutUpdateInRenderForAnotherComponent = new Set();
}

function warnAboutRenderPhaseUpdatesInDEV(fiber) {
  if (__DEV__) {
    if (
      ReactCurrentDebugFiberIsRenderingInDEV &&
      (executionContext & RenderContext) !== NoContext &&
      !getIsUpdatingOpaqueValueInRenderPhaseInDEV()
    ) {
      switch (fiber.tag) {
        case FunctionComponent:
        case ForwardRef:
        case SimpleMemoComponent: {
          const renderingComponentName =
            (workInProgress && getComponentName(workInProgress.type)) ||
            'Unknown';
          // Dedupe by the rendering component because it's the one that needs to be fixed.
          const dedupeKey = renderingComponentName;
          if (!didWarnAboutUpdateInRenderForAnotherComponent.has(dedupeKey)) {
            didWarnAboutUpdateInRenderForAnotherComponent.add(dedupeKey);
            const setStateComponentName =
              getComponentName(fiber.type) || 'Unknown';
            console.error(
              'Cannot update a component (`%s`) while rendering a ' +
                'different component (`%s`). To locate the bad setState() call inside `%s`, ' +
                'follow the stack trace as described in https://reactjs.org/link/setstate-in-render',
              setStateComponentName,
              renderingComponentName,
              renderingComponentName,
            );
          }
          break;
        }
        case ClassComponent: {
          if (!didWarnAboutUpdateInRender) {
            console.error(
              'Cannot update during an existing state transition (such as ' +
                'within `render`). Render methods should be a pure ' +
                'function of props and state.',
            );
            didWarnAboutUpdateInRender = true;
          }
          break;
        }
      }
    }
  }
}

// a 'shared' variable that changes when act() opens/closes in tests.
export const IsThisRendererActing = {current: (false: boolean)};

export function warnIfNotScopedWithMatchingAct(fiber: Fiber): void {
  if (__DEV__) {
    if (
      warnsIfNotActing === true &&
      IsSomeRendererActing.current === true &&
      IsThisRendererActing.current !== true
    ) {
      const previousFiber = ReactCurrentFiberCurrent;
      try {
        setCurrentDebugFiberInDEV(fiber);
        console.error(
          "It looks like you're using the wrong act() around your test interactions.\n" +
            'Be sure to use the matching version of act() corresponding to your renderer:\n\n' +
            '// for react-dom:\n' +
            // Break up imports to avoid accidentally parsing them as dependencies.
            'import {act} fr' +
            "om 'react-dom/test-utils';\n" +
            '// ...\n' +
            'act(() => ...);\n\n' +
            '// for react-test-renderer:\n' +
            // Break up imports to avoid accidentally parsing them as dependencies.
            'import TestRenderer fr' +
            "om react-test-renderer';\n" +
            'const {act} = TestRenderer;\n' +
            '// ...\n' +
            'act(() => ...);',
        );
      } finally {
        if (previousFiber) {
          setCurrentDebugFiberInDEV(fiber);
        } else {
          resetCurrentDebugFiberInDEV();
        }
      }
    }
  }
}

export function warnIfNotCurrentlyActingEffectsInDEV(fiber: Fiber): void {
  if (__DEV__) {
    if (
      warnsIfNotActing === true &&
      (fiber.mode & StrictMode) !== NoMode &&
      IsSomeRendererActing.current === false &&
      IsThisRendererActing.current === false
    ) {
      console.error(
        'An update to %s ran an effect, but was not wrapped in act(...).\n\n' +
          'When testing, code that causes React state updates should be ' +
          'wrapped into act(...):\n\n' +
          'act(() => {\n' +
          '  /* fire events that update state */\n' +
          '});\n' +
          '/* assert on the output */\n\n' +
          "This ensures that you're testing the behavior the user would see " +
          'in the browser.' +
          ' Learn more at https://reactjs.org/link/wrap-tests-with-act',
        getComponentName(fiber.type),
      );
    }
  }
}

function warnIfNotCurrentlyActingUpdatesInDEV(fiber: Fiber): void {
  if (__DEV__) {
    if (
      warnsIfNotActing === true &&
      executionContext === NoContext &&
      IsSomeRendererActing.current === false &&
      IsThisRendererActing.current === false
    ) {
      const previousFiber = ReactCurrentFiberCurrent;
      try {
        setCurrentDebugFiberInDEV(fiber);
        console.error(
          'An update to %s inside a test was not wrapped in act(...).\n\n' +
            'When testing, code that causes React state updates should be ' +
            'wrapped into act(...):\n\n' +
            'act(() => {\n' +
            '  /* fire events that update state */\n' +
            '});\n' +
            '/* assert on the output */\n\n' +
            "This ensures that you're testing the behavior the user would see " +
            'in the browser.' +
            ' Learn more at https://reactjs.org/link/wrap-tests-with-act',
          getComponentName(fiber.type),
        );
      } finally {
        if (previousFiber) {
          setCurrentDebugFiberInDEV(fiber);
        } else {
          resetCurrentDebugFiberInDEV();
        }
      }
    }
  }
}

export const warnIfNotCurrentlyActingUpdatesInDev = warnIfNotCurrentlyActingUpdatesInDEV;

// In tests, we want to enforce a mocked scheduler.
let didWarnAboutUnmockedScheduler = false;
// TODO Before we release concurrent mode, revisit this and decide whether a mocked
// scheduler is the actual recommendation. The alternative could be a testing build,
// a new lib, or whatever; we dunno just yet. This message is for early adopters
// to get their tests right.

export function warnIfUnmockedScheduler(fiber: Fiber) {
  if (__DEV__) {
    if (
      didWarnAboutUnmockedScheduler === false &&
      Scheduler.unstable_flushAllWithoutAsserting === undefined
    ) {
      if (fiber.mode & BlockingMode || fiber.mode & ConcurrentMode) {
        didWarnAboutUnmockedScheduler = true;
        console.error(
          'In Concurrent or Sync modes, the "scheduler" module needs to be mocked ' +
            'to guarantee consistent behaviour across tests and browsers. ' +
            'For example, with jest: \n' +
            // Break up requires to avoid accidentally parsing them as dependencies.
            "jest.mock('scheduler', () => require" +
            "('scheduler/unstable_mock'));\n\n" +
            'For more info, visit https://reactjs.org/link/mock-scheduler',
        );
      } else if (warnAboutUnmockedScheduler === true) {
        didWarnAboutUnmockedScheduler = true;
        console.error(
          'Starting from React v18, the "scheduler" module will need to be mocked ' +
            'to guarantee consistent behaviour across tests and browsers. ' +
            'For example, with jest: \n' +
            // Break up requires to avoid accidentally parsing them as dependencies.
            "jest.mock('scheduler', () => require" +
            "('scheduler/unstable_mock'));\n\n" +
            'For more info, visit https://reactjs.org/link/mock-scheduler',
        );
      }
    }
  }
}

function computeThreadID(root: FiberRoot, lane: Lane | Lanes) {
  // Interaction threads are unique per root and expiration time.
  // NOTE: Intentionally unsound cast. All that matters is that it's a number
  // and it represents a batch of work. Could make a helper function instead,
  // but meh this is fine for now.
  return (lane: any) * 1000 + root.interactionThreadID;
}

export function markSpawnedWork(lane: Lane | Lanes) {
  if (!enableSchedulerTracing) {
    return;
  }
  if (spawnedWorkDuringRender === null) {
    spawnedWorkDuringRender = [lane];
  } else {
    spawnedWorkDuringRender.push(lane);
  }
}

// 更新interaction的__count以及fiberRoot.pendingInteractionMap
// 作用???
function scheduleInteractions(
  root: FiberRoot,
  lane: Lane | Lanes, // expirationTimes[i]
  interactions: Set<Interaction>, // fiberRoot.memoizedInteractions
) {
  if (!enableSchedulerTracing) {
    return;
  }

  if (interactions.size > 0) {
    const pendingInteractionMap = root.pendingInteractionMap;
    const pendingInteractions = pendingInteractionMap.get(lane);
    if (pendingInteractions != null) {
      interactions.forEach((interaction) => {
        if (!pendingInteractions.has(interaction)) {
          // Update the pending async work count for previously unscheduled interaction.
          // 更新之前未调度的interaction的__count
          interaction.__count++;
        }

        pendingInteractions.add(interaction);
      });
    } else {
      pendingInteractionMap.set(lane, new Set(interactions));

      // Update the pending async work count for the current interactions.
      // 更新当前的interaction的__count
      interactions.forEach((interaction) => {
        interaction.__count++;
      });
    }

    const subscriber = __subscriberRef.current;
    if (subscriber !== null) {
      const threadID = computeThreadID(root, lane);
      subscriber.onWorkScheduled(interactions, threadID);
    }
  }
}

function schedulePendingInteractions(root: FiberRoot, lane: Lane | Lanes) {
  // This is called when work is scheduled on a root.
  // It associates the current interactions with the newly-scheduled expiration.
  // They will be restored when that expiration is later committed.
  if (!enableSchedulerTracing) {
    return;
  }

  scheduleInteractions(root, lane, __interactionsRef.current);
}

// 将调度优先级高的interaction加入到interactions中
function startWorkOnPendingInteractions(root: FiberRoot, lanes: Lanes) {
  // This is called when new work is started on a root.
  // root刚开始工作的时候会调用这个方法
  if (!enableSchedulerTracing) {
    return;
  }

  // Determine which interactions this batch of work currently includes, So that
  // we can accurately attribute time spent working on it, And so that cascading
  // work triggered during the render phase will be associated with it.
  // 确定当前要进行哪些交互工作，便于计算时间及其render阶段与之相关的级联工作

  // 获取root.pendingInteractionMap中有和root相同lanes的scheduledInteractions，添加到interactions中
  const interactions: Set<Interaction> = new Set();
  root.pendingInteractionMap.forEach((scheduledInteractions, scheduledLane) => {
    if (includesSomeLane(lanes, scheduledLane)) {
      scheduledInteractions.forEach((interaction) =>
        interactions.add(interaction),
      );
    }
  });

  // Store the current set of interactions on the FiberRoot for a few reasons:
  // We can re-use it in hot functions like performConcurrentWorkOnRoot()
  // without having to recalculate it. We will also use it in commitWork() to
  // pass to any Profiler onRender() hooks. This also provides DevTools with a
  // way to access it when the onCommitRoot() hook is called.
  // 在fiberRoot上挂载interactions
  root.memoizedInteractions = interactions;

  if (interactions.size > 0) {
    const subscriber = __subscriberRef.current;
    if (subscriber !== null) {
      const threadID = computeThreadID(root, lanes);
      try {
        subscriber.onWorkStarted(interactions, threadID);
      } catch (error) {
        // If the subscriber throws, rethrow it in a separate task
        scheduleCallback(ImmediateSchedulerPriority, () => {
          throw error;
        });
      }
    }
  }
}

// 完成FfiberRoot.pendingInteractionMap中的所有scheduledInteractions
function finishPendingInteractions(root, committedLanes) {
  if (!enableSchedulerTracing) {
    return;
  }

  const remainingLanesAfterCommit = root.pendingLanes;

  let subscriber;

  try {
    subscriber = __subscriberRef.current;
    if (subscriber !== null && root.memoizedInteractions.size > 0) {
      // FIXME: More than one lane can finish in a single commit.
      const threadID = computeThreadID(root, committedLanes);
      subscriber.onWorkStopped(root.memoizedInteractions, threadID);
    }
  } catch (error) {
    // If the subscriber throws, rethrow it in a separate task
    scheduleCallback(ImmediateSchedulerPriority, () => {
      throw error;
    });
  } finally {
    // Clear completed interactions from the pending Map.
    // Unless the render was suspended or cascading work was scheduled,
    // In which case– leave pending interactions until the subsequent render.
    const pendingInteractionMap = root.pendingInteractionMap;
    pendingInteractionMap.forEach((scheduledInteractions, lane) => {
      // Only decrement the pending interaction count if we're done.
      // If there's still work at the current priority,
      // That indicates that we are waiting for suspense data.

      // root.pendingLanes和lane没有交集
      if (!includesSomeLane(remainingLanesAfterCommit, lane)) {
        pendingInteractionMap.delete(lane);

        scheduledInteractions.forEach((interaction) => {
          interaction.__count--;

          if (subscriber !== null && interaction.__count === 0) {
            try {
              subscriber.onInteractionScheduledWorkCompleted(interaction);
            } catch (error) {
              // If the subscriber throws, rethrow it in a separate task
              scheduleCallback(ImmediateSchedulerPriority, () => {
                throw error;
              });
            }
          }
        });
      }
    });
  }
}

// `act` testing API
//
// TODO: This is mostly a copy-paste from the legacy `act`, which does not have
// access to the same internals that we do here. Some trade offs in the
// implementation no longer make sense.

let isFlushingAct = false;
let isInsideThisAct = false;

function shouldForceFlushFallbacksInDEV() {
  // Never force flush in production. This function should get stripped out.
  return __DEV__ && actingUpdatesScopeDepth > 0;
}

const flushMockScheduler = Scheduler.unstable_flushAllWithoutAsserting;
const isSchedulerMocked = typeof flushMockScheduler === 'function';

// Returns whether additional work was scheduled. Caller should keep flushing
// until there's no work left.
function flushActWork(): boolean {
  if (flushMockScheduler !== undefined) {
    const prevIsFlushing = isFlushingAct;
    isFlushingAct = true;
    try {
      return flushMockScheduler();
    } finally {
      isFlushingAct = prevIsFlushing;
    }
  } else {
    // No mock scheduler available. However, the only type of pending work is
    // passive effects, which we control. So we can flush that.
    const prevIsFlushing = isFlushingAct;
    isFlushingAct = true;
    try {
      let didFlushWork = false;
      while (flushPassiveEffects()) {
        didFlushWork = true;
      }
      return didFlushWork;
    } finally {
      isFlushingAct = prevIsFlushing;
    }
  }
}

function flushWorkAndMicroTasks(onDone: (err: ?Error) => void) {
  try {
    flushActWork();
    enqueueTask(() => {
      if (flushActWork()) {
        flushWorkAndMicroTasks(onDone);
      } else {
        onDone();
      }
    });
  } catch (err) {
    onDone(err);
  }
}

// we track the 'depth' of the act() calls with this counter,
// so we can tell if any async act() calls try to run in parallel.

let actingUpdatesScopeDepth = 0;
let didWarnAboutUsingActInProd = false;

export function act(callback: () => Thenable<mixed>): Thenable<void> {
  if (!__DEV__) {
    if (didWarnAboutUsingActInProd === false) {
      didWarnAboutUsingActInProd = true;
      // eslint-disable-next-line react-internal/no-production-logging
      console.error(
        'act(...) is not supported in production builds of React, and might not behave as expected.',
      );
    }
  }

  const previousActingUpdatesScopeDepth = actingUpdatesScopeDepth;
  actingUpdatesScopeDepth++;

  const previousIsSomeRendererActing = IsSomeRendererActing.current;
  const previousIsThisRendererActing = IsThisRendererActing.current;
  const previousIsInsideThisAct = isInsideThisAct;
  IsSomeRendererActing.current = true;
  IsThisRendererActing.current = true;
  isInsideThisAct = true;

  function onDone() {
    actingUpdatesScopeDepth--;
    IsSomeRendererActing.current = previousIsSomeRendererActing;
    IsThisRendererActing.current = previousIsThisRendererActing;
    isInsideThisAct = previousIsInsideThisAct;
    if (__DEV__) {
      if (actingUpdatesScopeDepth > previousActingUpdatesScopeDepth) {
        // if it's _less than_ previousActingUpdatesScopeDepth, then we can assume the 'other' one has warned
        console.error(
          'You seem to have overlapping act() calls, this is not supported. ' +
            'Be sure to await previous act() calls before making a new one. ',
        );
      }
    }
  }

  let result;
  try {
    result = batchedUpdates(callback);
  } catch (error) {
    // on sync errors, we still want to 'cleanup' and decrement actingUpdatesScopeDepth
    onDone();
    throw error;
  }

  if (
    result !== null &&
    typeof result === 'object' &&
    typeof result.then === 'function'
  ) {
    // setup a boolean that gets set to true only
    // once this act() call is await-ed
    let called = false;
    if (__DEV__) {
      if (typeof Promise !== 'undefined') {
        //eslint-disable-next-line no-undef
        Promise.resolve()
          .then(() => {})
          .then(() => {
            if (called === false) {
              console.error(
                'You called act(async () => ...) without await. ' +
                  'This could lead to unexpected testing behaviour, interleaving multiple act ' +
                  'calls and mixing their scopes. You should - await act(async () => ...);',
              );
            }
          });
      }
    }

    // in the async case, the returned thenable runs the callback, flushes
    // effects and  microtasks in a loop until flushPassiveEffects() === false,
    // and cleans up
    return {
      then(resolve, reject) {
        called = true;
        result.then(
          () => {
            if (
              actingUpdatesScopeDepth > 1 ||
              (isSchedulerMocked === true &&
                previousIsSomeRendererActing === true)
            ) {
              onDone();
              resolve();
              return;
            }
            // we're about to exit the act() scope,
            // now's the time to flush tasks/effects
            flushWorkAndMicroTasks((err: ?Error) => {
              onDone();
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          },
          (err) => {
            onDone();
            reject(err);
          },
        );
      },
    };
  } else {
    if (__DEV__) {
      if (result !== undefined) {
        console.error(
          'The callback passed to act(...) function ' +
            'must return undefined, or a Promise. You returned %s',
          result,
        );
      }
    }

    // flush effects until none remain, and cleanup
    try {
      if (
        actingUpdatesScopeDepth === 1 &&
        (isSchedulerMocked === false || previousIsSomeRendererActing === false)
      ) {
        // we're about to exit the act() scope,
        // now's the time to flush effects
        flushActWork();
      }
      onDone();
    } catch (err) {
      onDone();
      throw err;
    }

    // in the sync case, the returned thenable only warns *if* await-ed
    return {
      then(resolve) {
        if (__DEV__) {
          console.error(
            'Do not await the result of calling act(...) with sync logic, it is not a Promise.',
          );
        }
        resolve();
      },
    };
  }
}

// 清空fiber的siblng和stateNode
function detachFiberAfterEffects(fiber: Fiber): void {
  fiber.sibling = null;
  fiber.stateNode = null;
}
