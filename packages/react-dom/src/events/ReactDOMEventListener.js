/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {AnyNativeEvent} from '../events/PluginModuleType';
import type {FiberRoot} from 'react-reconciler/src/ReactInternalTypes';
import type {Container, SuspenseInstance} from '../client/ReactDOMHostConfig';
import type {DOMEventName} from '../events/DOMEventNames';

// Intentionally not named imports because Rollup would use dynamic dispatch for
// CommonJS interop named imports.
import * as Scheduler from 'scheduler';

import {
  isReplayableDiscreteEvent,
  queueDiscreteEvent,
  hasQueuedDiscreteEvents,
  clearIfContinuousEvent,
  queueIfContinuousEvent,
} from './ReactDOMEventReplaying';
import {
  getNearestMountedFiber,
  getContainerFromFiber,
  getSuspenseInstanceFromFiber,
} from 'react-reconciler/src/ReactFiberTreeReflection';
import {HostRoot, SuspenseComponent} from 'react-reconciler/src/ReactWorkTags';
import {
  type EventSystemFlags,
  IS_CAPTURE_PHASE,
  IS_LEGACY_FB_SUPPORT_MODE,
} from './EventSystemFlags';

import getEventTarget from './getEventTarget';
import {getClosestInstanceFromNode} from '../client/ReactDOMComponentTree';

import {
  enableLegacyFBSupport,
  decoupleUpdatePriorityFromScheduler,
} from 'shared/ReactFeatureFlags';
import {
  UserBlockingEvent,
  ContinuousEvent,
  DiscreteEvent,
} from 'shared/ReactTypes';
import {getEventPriorityForPluginSystem} from './DOMEventProperties';
import {dispatchEventForPluginEventSystem} from './DOMPluginEventSystem';
import {
  flushDiscreteUpdatesIfNeeded,
  discreteUpdates,
} from './ReactDOMUpdateBatching';
import {
  InputContinuousLanePriority,
  getCurrentUpdateLanePriority,
  setCurrentUpdateLanePriority,
} from 'react-reconciler/src/ReactFiberLane';

const {
  unstable_UserBlockingPriority: UserBlockingPriority,
  unstable_runWithPriority: runWithPriority,
} = Scheduler;

// TODO: can we stop exporting these?
export let _enabled = true;

// This is exported in FB builds for use by legacy FB layer infra.
// We'd like to remove this but it's not clear if this is safe.
export function setEnabled(enabled: ?boolean) {
  _enabled = !!enabled;
}

export function isEnabled() {
  return _enabled;
}

export function createEventListenerWrapper(
  targetContainer: EventTarget,
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
): Function {
  return dispatchEvent.bind(
    null,
    domEventName,
    eventSystemFlags,
    targetContainer,
  );
}

// 根据优先级生成对应事件
export function createEventListenerWrapperWithPriority(
  targetContainer: EventTarget, // 事件容器
  domEventName: DOMEventName, // 事件名
  eventSystemFlags: EventSystemFlags, // 事件标志
): Function {
  // 获取事件优先级，若没有，则默认为继续事件优先级2
  const eventPriority = getEventPriorityForPluginSystem(domEventName);
  let listenerWrapper;
  switch (eventPriority) {
    // 0 离散事件
    case DiscreteEvent:
      listenerWrapper = dispatchDiscreteEvent;
      break;
    // 1 用户阻塞事件
    case UserBlockingEvent:
      listenerWrapper = dispatchUserBlockingUpdate;
      break;
    // 2 继续事件
    case ContinuousEvent:
    default:
      listenerWrapper = dispatchEvent;
      break;
  }
  return listenerWrapper.bind(
    null, // context
    domEventName, // 事件名 
    eventSystemFlags, // 事件标志
    targetContainer, // 事件容器
  );
}

// 将isInsideEventHandler设为true，执行dispatchEvent(domEventName,eventSystemFlags,container,nativeEvent)
function dispatchDiscreteEvent(
  domEventName,
  eventSystemFlags,
  container,
  nativeEvent,
) {
  if (
    !enableLegacyFBSupport ||
    // If we are in Legacy FB support mode, it means we've already
    // flushed for this event and we don't need to do it again.
    (eventSystemFlags & IS_LEGACY_FB_SUPPORT_MODE) === 0
  ) {
    flushDiscreteUpdatesIfNeeded(nativeEvent.timeStamp);
  }
  // 将isInsideEventHandler设为true，执行dispatchEvent(domEventName,eventSystemFlags,container,nativeEvent)
  discreteUpdates(
    dispatchEvent,
    domEventName,
    eventSystemFlags,
    container,
    nativeEvent,
  );
}

// 根据decoupleUpdatePriorityFromScheduler来判断是否有这一步，将currentUpdateLanePriority设为InputContinuousLanePriority(也就是10)
// 将currentPriorityLevel设为UserBlockingPriority(也就是1)
// 执行dispatchEvent(domEventName,eventSystemFlags,container,nativeEvent)函数
function dispatchUserBlockingUpdate(
  domEventName,
  eventSystemFlags,
  container,
  nativeEvent,
) {
  if (decoupleUpdatePriorityFromScheduler) {
    // 将currentUpdateLanePriority设为InputContinuousLanePriority(也就是10)
    // 将currentPriorityLevel设为UserBlockingPriority(也就是1)
    // 执行dispatchEvent(domEventName,eventSystemFlags,container,nativeEvent)函数
    const previousPriority = getCurrentUpdateLanePriority();
    try {
      // TODO: Double wrapping is necessary while we decouple Scheduler priority.
      // InputContinuousLanePriority为10
      setCurrentUpdateLanePriority(InputContinuousLanePriority);
      // 将currentPriorityLevel设为UserBlockingPriority(也就是1)，执行dispatchEvent函数
      runWithPriority(
        UserBlockingPriority,
        dispatchEvent.bind(
          null,
          domEventName,
          eventSystemFlags,
          container,
          nativeEvent,
        ),
      );
    } finally {
      setCurrentUpdateLanePriority(previousPriority);
    }
  } else {
    // 将currentPriorityLevel设为UserBlockingPriority(也就是1)，执行dispatchEvent函数
    runWithPriority(
      UserBlockingPriority,
      dispatchEvent.bind(
        null,
        domEventName,
        eventSystemFlags,
        container,
        nativeEvent,
      ),
    );
  }
}

export function dispatchEvent(
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
  targetContainer: EventTarget,
  nativeEvent: AnyNativeEvent,
): void {

  if (!_enabled) {
    return;
  }

  // TODO: replaying capture phase events is currently broken
  // because we used to do it during top-level native bubble handlers
  // but now we use different bubble and capture handlers.
  // In eager mode, we attach capture listeners early, so we need
  // to filter them out until we fix the logic to handle them correctly.
  const allowReplay = (eventSystemFlags & IS_CAPTURE_PHASE) === 0;

  if (
    allowReplay &&
    hasQueuedDiscreteEvents() &&
    isReplayableDiscreteEvent(domEventName)
  ) {
    // If we already have a queue of discrete events, and this is another discrete
    // event, then we can't dispatch it regardless of its target, since they
    // need to dispatch in order.
    queueDiscreteEvent(
      null, // Flags that we're not actually blocked on anything as far as we know.
      domEventName,
      eventSystemFlags,
      targetContainer,
      nativeEvent,
    );
    return;
  }

  const blockedOn = attemptToDispatchEvent(
    domEventName,
    eventSystemFlags,
    targetContainer,
    nativeEvent,
  );

  if (blockedOn === null) {
    // We successfully dispatched this event.
    if (allowReplay) {
      clearIfContinuousEvent(domEventName, nativeEvent);
    }
    return;
  }

  if (allowReplay) {
    if (isReplayableDiscreteEvent(domEventName)) {
      // This this to be replayed later once the target is available.
      queueDiscreteEvent(
        blockedOn,
        domEventName,
        eventSystemFlags,
        targetContainer,
        nativeEvent,
      );
      return;
    }
    if (
      queueIfContinuousEvent(
        blockedOn,
        domEventName,
        eventSystemFlags,
        targetContainer,
        nativeEvent,
      )
    ) {
      return;
    }
    // We need to clear only if we didn't queue because
    // queueing is accummulative.
    clearIfContinuousEvent(domEventName, nativeEvent);
  }

  // This is not replayable so we'll invoke it but without a target,
  // in case the event system needs to trace it.
  dispatchEventForPluginEventSystem(
    domEventName,
    eventSystemFlags,
    nativeEvent,
    null,
    targetContainer,
  );
}

// Attempt dispatching an event. Returns a SuspenseInstance or Container if it's blocked.
export function attemptToDispatchEvent(
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
  targetContainer: EventTarget,
  nativeEvent: AnyNativeEvent,
): null | Container | SuspenseInstance {
  // TODO: Warn if _enabled is false.

  const nativeEventTarget = getEventTarget(nativeEvent);
  let targetInst = getClosestInstanceFromNode(nativeEventTarget);

  if (targetInst !== null) {
    const nearestMounted = getNearestMountedFiber(targetInst);
    if (nearestMounted === null) {
      // This tree has been unmounted already. Dispatch without a target.
      targetInst = null;
    } else {
      const tag = nearestMounted.tag;
      if (tag === SuspenseComponent) {
        const instance = getSuspenseInstanceFromFiber(nearestMounted);
        if (instance !== null) {
          // Queue the event to be replayed later. Abort dispatching since we
          // don't want this event dispatched twice through the event system.
          // TODO: If this is the first discrete event in the queue. Schedule an increased
          // priority for this boundary.
          return instance;
        }
        // This shouldn't happen, something went wrong but to avoid blocking
        // the whole system, dispatch the event without a target.
        // TODO: Warn.
        targetInst = null;
      } else if (tag === HostRoot) {
        const root: FiberRoot = nearestMounted.stateNode;
        if (root.hydrate) {
          // If this happens during a replay something went wrong and it might block
          // the whole system.
          return getContainerFromFiber(nearestMounted);
        }
        targetInst = null;
      } else if (nearestMounted !== targetInst) {
        // If we get an event (ex: img onload) before committing that
        // component's mount, ignore it for now (that is, treat it as if it was an
        // event on a non-React tree). We might also consider queueing events and
        // dispatching them after the mount.
        targetInst = null;
      }
    }
  }
  dispatchEventForPluginEventSystem(
    domEventName,
    eventSystemFlags,
    nativeEvent,
    targetInst,
    targetContainer,
  );
  // We're not blocked on anything.
  return null;
}
