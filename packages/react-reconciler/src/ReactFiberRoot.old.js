/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {FiberRoot, SuspenseHydrationCallbacks} from './ReactInternalTypes';
import type {RootTag} from './ReactRootTags';

import {noTimeout, supportsHydration} from './ReactFiberHostConfig';
import {createHostRootFiber} from './ReactFiber.old';
import {
  NoLanes,
  NoLanePriority,
  NoTimestamp,
  createLaneMap,
} from './ReactFiberLane';
import {
  enableSchedulerTracing,
  enableSuspenseCallback,
} from 'shared/ReactFeatureFlags';
import {unstable_getThreadID} from 'scheduler/tracing';
import {initializeUpdateQueue} from './ReactUpdateQueue.old';
import {LegacyRoot, BlockingRoot, ConcurrentRoot} from './ReactRootTags';

// FiberRootNode是FiberNode的特殊形式，它是整个应用的起点，记录整个应用更新过程的所有信息，包含挂载的目标节点
function FiberRootNode(containerInfo, tag, hydrate) {
  // 用于标记fiberRoot的类型
  this.tag = tag;
  // 和fiberRoot关联的DOM容器的相关信息，就是我们挂载的DOM节点
  this.containerInfo = containerInfo;
  // react-dom中不涉及，持久化更新使用
  this.pendingChildren = null;
  // 指向当前激活的与之对应的rootFiber节点
  // Root Fiber/uninitializedFiber, 每一个React应用都会有一个对应的根Fiber
  this.current = null;
  this.pingCache = null;
  // 在某个更新中，已经完成的任务。当完成更新后，就会将数据渲染到DOM节点上。
  // 而这个过程的本质就是读取finishedWork数据
  this.finishedWork = null;
  this.timeoutHandle = noTimeout;
  // 只有在调用renderSubtreeInfoContainer API才会使用到，可以忽略
  this.context = null;
  this.pendingContext = null;
  // 当前的fiberRoot是否处于hydrate模式
  this.hydrate = hydrate;
  // 每个fiberRoot实例上都只会维护一个任务，该任务保存在callbackNode属性中
  this.callbackNode = null;
  // 当前任务的优先级
  this.callbackPriority = NoLanePriority;
  this.eventTimes = createLaneMap(NoLanes);
  this.expirationTimes = createLaneMap(NoTimestamp);

  this.pendingLanes = NoLanes;
  this.suspendedLanes = NoLanes;
  this.pingedLanes = NoLanes;
  this.expiredLanes = NoLanes;
  this.mutableReadLanes = NoLanes;
  this.finishedLanes = NoLanes;

  this.entangledLanes = NoLanes;
  this.entanglements = createLaneMap(NoLanes);

  if (supportsHydration) {
    this.mutableSourceEagerHydrationData = null;
  }

  if (enableSchedulerTracing) {
    this.interactionThreadID = unstable_getThreadID();
    this.memoizedInteractions = new Set();
    this.pendingInteractionMap = new Map();
  }
  if (enableSuspenseCallback) {
    this.hydrationCallbacks = null;
  }

  if (__DEV__) {
    switch (tag) {
      case BlockingRoot:
        this._debugRootType = 'createBlockingRoot()';
        break;
      case ConcurrentRoot:
        this._debugRootType = 'createRoot()';
        break;
      case LegacyRoot:
        this._debugRootType = 'createLegacyRoot()';
        break;
    }
  }
}

// 创建fiberRoot和rootFiber并相互引用
export function createFiberRoot(
  containerInfo: any, // 生成fiberRoot时对应document.getElementById('root')
  tag: RootTag, // fiberRoot节点的标记(LegacyRoot、BatchedRoot、ConcurrentRoot)
  hydrate: boolean,
  hydrationCallbacks: null | SuspenseHydrationCallbacks, // 只有在hydrate模式时才可能有值，该对象包含两个可选的方法：onHydrated和onDeleted
): FiberRoot {
  // 通过FiberRootNode构造函数创建一个fiberRoot实例
  const root: FiberRoot = (new FiberRootNode(containerInfo, tag, hydrate): any);
  if (enableSuspenseCallback) {
    root.hydrationCallbacks = hydrationCallbacks;
  }

  // Cyclic construction. This cheats the type system right now because
  // stateNode is any.
  // 通过createHostRootFiber方法创建fiber tree的根节点，即rootFiber
  // 需要留意的是，fiber节点也会像DOM树结构一样形成一个fiber tree单链表树结构
  // 每个DOM节点或者组件都会生成一个与之对应的fiber节点
  // 在后续的调和(reconciliation)阶段起着至关重要的作用
  const uninitializedFiber = createHostRootFiber(tag);
  // 创建完rootFiber之后，会将fiberRoot实例的current属性指向刚创建的hostRootFiber
  root.current = uninitializedFiber;
  // 同时hostRootFiber的stateNode属性会指向fiberRoot实例，形成相互引用
  uninitializedFiber.stateNode = root;

  // 初始化hostRootFiber的updateQueue
  initializeUpdateQueue(uninitializedFiber);

  return root;
}
