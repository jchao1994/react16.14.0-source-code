/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';
import type {Lanes} from './ReactFiberLane';
import type {
  ReactFundamentalComponentInstance,
  ReactScopeInstance,
} from 'shared/ReactTypes';
import type {FiberRoot} from './ReactInternalTypes';
import type {
  Instance,
  Type,
  Props,
  Container,
  ChildSet,
} from './ReactFiberHostConfig';
import type {
  SuspenseState,
  SuspenseListRenderState,
} from './ReactFiberSuspenseComponent.old';
import type {SuspenseContext} from './ReactFiberSuspenseContext.old';
import type {OffscreenState} from './ReactFiberOffscreenComponent';

import {resetWorkInProgressVersions as resetMutableSourceWorkInProgressVersions} from './ReactMutableSource.old';

import {now} from './SchedulerWithReactIntegration.old';

import {
  IndeterminateComponent,
  FunctionComponent,
  ClassComponent,
  HostRoot,
  HostComponent,
  HostText,
  HostPortal,
  ContextProvider,
  ContextConsumer,
  ForwardRef,
  Fragment,
  Mode,
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
import {NoMode, BlockingMode, ProfileMode} from './ReactTypeOfMode';
import {Ref, Update, NoFlags, DidCapture, Snapshot} from './ReactFiberFlags';
import invariant from 'shared/invariant';

import {
  createInstance,
  createTextInstance,
  appendInitialChild,
  finalizeInitialChildren,
  prepareUpdate,
  supportsMutation,
  supportsPersistence,
  cloneInstance,
  cloneHiddenInstance,
  cloneHiddenTextInstance,
  createContainerChildSet,
  appendChildToContainerChildSet,
  finalizeContainerChildren,
  getFundamentalComponentInstance,
  mountFundamentalComponent,
  cloneFundamentalInstance,
  shouldUpdateFundamentalComponent,
  preparePortalMount,
  prepareScopeUpdate,
} from './ReactFiberHostConfig';
import {
  getRootHostContainer,
  popHostContext,
  getHostContext,
  popHostContainer,
} from './ReactFiberHostContext.old';
import {
  suspenseStackCursor,
  InvisibleParentSuspenseContext,
  hasSuspenseContext,
  popSuspenseContext,
  pushSuspenseContext,
  setShallowSuspenseContext,
  ForceSuspenseFallback,
  setDefaultShallowSuspenseContext,
} from './ReactFiberSuspenseContext.old';
import {findFirstSuspended} from './ReactFiberSuspenseComponent.old';
import {
  isContextProvider as isLegacyContextProvider,
  popContext as popLegacyContext,
  popTopLevelContextObject as popTopLevelLegacyContextObject,
} from './ReactFiberContext.old';
import {popProvider} from './ReactFiberNewContext.old';
import {
  prepareToHydrateHostInstance,
  prepareToHydrateHostTextInstance,
  prepareToHydrateHostSuspenseInstance,
  popHydrationState,
  resetHydrationState,
  getIsHydrating,
} from './ReactFiberHydrationContext.old';
import {
  enableSchedulerTracing,
  enableSuspenseCallback,
  enableSuspenseServerRenderer,
  enableFundamentalAPI,
  enableScopeAPI,
  enableBlocksAPI,
  enableProfilerTimer,
} from 'shared/ReactFeatureFlags';
import {
  markSpawnedWork,
  renderDidSuspend,
  renderDidSuspendDelayIfPossible,
  renderHasNotSuspendedYet,
  popRenderLanes,
  getRenderTargetTime,
} from './ReactFiberWorkLoop.old';
import {createFundamentalStateInstance} from './ReactFiberFundamental.old';
import {OffscreenLane, SomeRetryLane} from './ReactFiberLane';
import {resetChildFibers} from './ReactChildFiber.old';
import {createScopeInstance} from './ReactFiberScope.old';
import {transferActualDuration} from './ReactProfilerTimer.old';

function markUpdate(workInProgress: Fiber) {
  // Tag the fiber with an update effect. This turns a Placement into
  // a PlacementAndUpdate.
  workInProgress.flags |= Update;
}

function markRef(workInProgress: Fiber) {
  workInProgress.flags |= Ref;
}

let appendAllChildren;
let updateHostContainer;
let updateHostComponent;
let updateHostText;
if (supportsMutation) {
  // Mutation mode

  // 添加workInProgress的子节点对应的dom到parent的dom结构中
  appendAllChildren = function(
    parent: Instance, // reactElement
    workInProgress: Fiber,
    needsVisibilityToggle: boolean,
    isHidden: boolean,
  ) {
    // We only have the top Fiber that was created but we need recurse down its
    // children to find all the terminal nodes.
    // 遍历children找到所有末端workInProgress
    let node = workInProgress.child;
    while (node !== null) {
      if (node.tag === HostComponent || node.tag === HostText) {
        // 父reactElement中添加子reactElement
        appendInitialChild(parent, node.stateNode);
      } else if (enableFundamentalAPI && node.tag === FundamentalComponent) {
        // 父reactElement中添加子reactElement
        appendInitialChild(parent, node.stateNode.instance);
      } else if (node.tag === HostPortal) {
        // If we have a portal child, then we don't want to traverse
        // down its children. Instead, we'll get insertions from each child in
        // the portal directly.
      } else if (node.child !== null) {
        // 不满足上述情况
        // fragment???
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
  };

  updateHostContainer = function(workInProgress: Fiber) {
    // Noop
  };
  // diff新老props，workInProgress的更新队列即为需要更新的props updatePayload数组
  // 在beginWork中updateQueue存放的是baseQueue链表和updateQueue.shared.pending链表，用于生成新state的，这里做了替换???
  updateHostComponent = function(
    current: Fiber,
    workInProgress: Fiber,
    type: Type,
    newProps: Props,
    rootContainerInstance: Container,
  ) {
    // If we have an alternate, that means this is an update and we need to
    // schedule a side-effect to do the updates.
    const oldProps = current.memoizedProps;
    if (oldProps === newProps) {
      // In mutation mode, this is sufficient for a bailout because
      // we won't touch this node even if children changed.
      // 新老props相同，直接return
      return;
    }

    // If we get updated because one of our children updated, we don't
    // have newProps so we'll have to reuse them.
    // TODO: Split the update API as separate for the props vs. children.
    // Even better would be if children weren't special cased at all tho.
    // workInProgress对应的reactElement
    const instance: Instance = workInProgress.stateNode;
    // 当前上下文context
    const currentHostContext = getHostContext();
    // TODO: Experiencing an error where oldProps is null. Suggests a host
    // component is hitting the resume path. Figure out why. Possibly
    // related to `hidden`.
    // diff新老props拿到需要更新的updatePayload数组
    const updatePayload = prepareUpdate(
      instance,
      type,
      oldProps,
      newProps,
      rootContainerInstance,
      currentHostContext,
    );
    // TODO: Type this specific to this type of component.
    // workInProgress的更新队列即为需要更新的props updatePayload数组
    // 在beginWork中updateQueue存放的是baseQueue链表和updateQueue.shared.pending链表，用于生成新state的，这里做了替换???
    workInProgress.updateQueue = (updatePayload: any);
    // If the update payload indicates that there is a change or if there
    // is a new ref we mark this as an update. All the work is done in commitWork.
    // 如有updatePayload，给workInProgress添加Update副作用
    if (updatePayload) {
      markUpdate(workInProgress);
    }
  };
  updateHostText = function(
    current: Fiber,
    workInProgress: Fiber,
    oldText: string,
    newText: string,
  ) {
    // If the text differs, mark it as an update. All the work in done in commitWork.
    if (oldText !== newText) {
      markUpdate(workInProgress);
    }
  };
} else if (supportsPersistence) {
  // Persistent host tree mode

  // 添加workInProgress的子节点对应的dom到parent的dom结构中
  appendAllChildren = function(
    parent: Instance, // 新newInstance
    workInProgress: Fiber, // workInProgress
    needsVisibilityToggle: boolean, // false
    isHidden: boolean, // false
  ) {
    // We only have the top Fiber that was created but we need recurse down its
    // children to find all the terminal nodes.
    // 遍历workInProgress找到所有末端workInProgress
    // 让所有子workInProgress对应的stateNode或是stateNode.instance添加到parent的dom结构中
    let node = workInProgress.child;
    while (node !== null) {
      // eslint-disable-next-line no-labels
      branches: if (node.tag === HostComponent) {
        let instance = node.stateNode;
        if (needsVisibilityToggle && isHidden) {
          // This child is inside a timed out tree. Hide it.
          const props = node.memoizedProps;
          const type = node.type;
          instance = cloneHiddenInstance(instance, type, props, node);
        }
        // parent.appendChild(instance)
        appendInitialChild(parent, instance);
      } else if (node.tag === HostText) {
        let instance = node.stateNode;
        if (needsVisibilityToggle && isHidden) {
          // This child is inside a timed out tree. Hide it.
          const text = node.memoizedProps;
          instance = cloneHiddenTextInstance(instance, text, node);
        }
        // parent.appendChild(instance)
        appendInitialChild(parent, instance);
      } else if (enableFundamentalAPI && node.tag === FundamentalComponent) {
        let instance = node.stateNode.instance;
        if (needsVisibilityToggle && isHidden) {
          // This child is inside a timed out tree. Hide it.
          const props = node.memoizedProps;
          const type = node.type;
          instance = cloneHiddenInstance(instance, type, props, node);
        }
        // parent.appendChild(instance)
        appendInitialChild(parent, instance);
      } else if (node.tag === HostPortal) {
        // If we have a portal child, then we don't want to traverse
        // down its children. Instead, we'll get insertions from each child in
        // the portal directly.
      } else if (node.tag === SuspenseComponent) {
        // Suspense和fragment有点相似
        // Suspense标签不占dom位置，所以是将children对应的dom添加到parent的dom结构中
        if ((node.flags & Update) !== NoFlags) {
          // 需要更新
          // Need to toggle the visibility of the primary children.
          const newIsHidden = node.memoizedState !== null;
          if (newIsHidden) {
            const primaryChildParent = node.child;
            if (primaryChildParent !== null) {
              if (primaryChildParent.child !== null) {
                primaryChildParent.child.return = primaryChildParent;
                appendAllChildren(
                  parent,
                  primaryChildParent,
                  true,
                  newIsHidden, // true
                );
              }
              const fallbackChildParent = primaryChildParent.sibling;
              if (fallbackChildParent !== null) {
                fallbackChildParent.return = node;
                node = fallbackChildParent;
                continue;
              }
            }
          }
        }
        if (node.child !== null) {
          // Continue traversing like normal
          node.child.return = node;
          node = node.child;
          continue;
        }
      } else if (node.child !== null) {
        // 不满足上述，就找child
        // 这里是fragment???
        node.child.return = node;
        node = node.child;
        continue;
      }
      // $FlowFixMe This is correct but Flow is confused by the labeled break.
      // 遍历所有兄弟workInProgress
      node = (node: Fiber);
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
  };

  // An unfortunate fork of appendAllChildren because we have two different parent types.
  // 添加workInProgress的子节点对应的dom的node到containerChildSet中
  const appendAllChildrenToContainer = function(
    containerChildSet: ChildSet, // newChildSet
    workInProgress: Fiber, // workInProgress
    needsVisibilityToggle: boolean, // false
    isHidden: boolean, // false
  ) {
    // We only have the top Fiber that was created but we need recurse down its
    // children to find all the terminal nodes.
    // 目前只有最顶层workInProgress，所以需要递归children来找到所有末端workInProgress

    // workInProgress第一个子节点
    let node = workInProgress.child;
    while (node !== null) {
      // eslint-disable-next-line no-labels
      branches: if (node.tag === HostComponent) {
        // 原生dom fiber
        let instance = node.stateNode;
        if (needsVisibilityToggle && isHidden) {
          // This child is inside a timed out tree. Hide it.
          const props = node.memoizedProps;
          const type = node.type;
          instance = cloneHiddenInstance(instance, type, props, node);
        }
        // containerChildSet.push(instance.node)
        appendChildToContainerChildSet(containerChildSet, instance);
      } else if (node.tag === HostText) {
        // 文本fiber
        let instance = node.stateNode;
        if (needsVisibilityToggle && isHidden) {
          // This child is inside a timed out tree. Hide it.
          const text = node.memoizedProps;
          instance = cloneHiddenTextInstance(instance, text, node);
        }
        // containerChildSet.push(instance.node)
        appendChildToContainerChildSet(containerChildSet, instance);
      } else if (enableFundamentalAPI && node.tag === FundamentalComponent) {
        let instance = node.stateNode.instance;
        if (needsVisibilityToggle && isHidden) {
          // This child is inside a timed out tree. Hide it.
          const props = node.memoizedProps;
          const type = node.type;
          instance = cloneHiddenInstance(instance, type, props, node);
        }
        // containerChildSet.push(instance.node)
        appendChildToContainerChildSet(containerChildSet, instance);
      } else if (node.tag === HostPortal) {
        // If we have a portal child, then we don't want to traverse
        // down its children. Instead, we'll get insertions from each child in
        // the portal directly.
      } else if (node.tag === SuspenseComponent) {
        // Suspense和fragment有点相似
        // Suspense标签不占dom位置，所以是将children dom对应的node添加到containerChildSet中
        if ((node.flags & Update) !== NoFlags) {
          // Need to toggle the visibility of the primary children.
          const newIsHidden = node.memoizedState !== null;
          if (newIsHidden) {
            const primaryChildParent = node.child;
            if (primaryChildParent !== null) {
              if (primaryChildParent.child !== null) {
                primaryChildParent.child.return = primaryChildParent;
                appendAllChildrenToContainer(
                  containerChildSet,
                  primaryChildParent,
                  true,
                  newIsHidden,
                );
              }
              const fallbackChildParent = primaryChildParent.sibling;
              if (fallbackChildParent !== null) {
                fallbackChildParent.return = node;
                node = fallbackChildParent;
                continue;
              }
            }
          }
        }
        if (node.child !== null) {
          // Continue traversing like normal
          node.child.return = node;
          node = node.child;
          continue;
        }
      } else if (node.child !== null) {
        // 不是以上这几种类型的fiber
        // 将child的父节点设置为当前节点
        // 这里不是应该已经设置好了吗???
        // 这里是fragment???
        node.child.return = node;
        // 直接取child进行下一次循环
        node = node.child;
        continue;
      }
      // $FlowFixMe This is correct but Flow is confused by the labeled break.
      node = (node: Fiber);
      // node为workInProgress，直接return出去
      if (node === workInProgress) {
        return;
      }
      // 递归完同级最后一个兄弟节点，重新到父节点
      // 递归完成最后一个末端节点，return出去
      while (node.sibling === null) {
        if (node.return === null || node.return === workInProgress) {
          return;
        }
        node = node.return;
      }
      // 这里设置下一个兄弟节点的父节点为当前节点的父节点
      // 这里不是应该已经设置好了吗???
      node.sibling.return = node.return;
      // 下一个兄弟节点
      node = node.sibling;
    }
  };
  // 根workInProgress
  // 1. workInProgress没有update队列，直接结束逻辑
  // 2. 创建newChildSet空数组，将workInProgress的子节点对应的dom的node添加到newChildSet(fiberRoot.pendingChildren)中
  //    在全局roots中添加key-value  fiberRoot.containerInfo-fiberRoot.pendingChildren
  updateHostContainer = function(workInProgress: Fiber) {
    // fiberRoot
    const portalOrRoot: {
      containerInfo: Container, // 容器
      pendingChildren: ChildSet, // 新的children
      ...
    } = workInProgress.stateNode;
    // 是否有update队列
    const childrenUnchanged = workInProgress.firstEffect === null;
    if (childrenUnchanged) {
      // No changes, just reuse the existing instance.、
      // workInProgress没有update队列，不做改变
    } else {
      // workInProgress有update队列
      const container = portalOrRoot.containerInfo; // 容器
      const newChildSet = createContainerChildSet(container); // []
      // If children might have changed, we have to add them all to the set.
      // 添加workInProgress的子节点对应的dom的node到newChildSet中
      // 这里的node是workInProgress.stateNode.node或workInProgress.stateNode.instance.node
      appendAllChildrenToContainer(newChildSet, workInProgress, false, false);
      // newChildSet更新完毕，赋值给fiberRoot.pendingChildren
      portalOrRoot.pendingChildren = newChildSet;
      // Schedule an update on the container to swap out the container.
      // 标记workInProgress需要更新
      markUpdate(workInProgress);
      // roots.set(container, newChildSet)
      // 在全局的roots map中添加key-value  fiberRoot.containerInfo-fiberRoot.pendingChildren
      // 全局roots.set(container, newChildSet)
      finalizeContainerChildren(container, newChildSet);
    }
  };
  // 处理dom结构，workInProgress的stateNode指向最新的dom，并且有最新的子dom
  // 1. 复用dom current.stateNode作为workInProgress.stateNode
  // 2. 或者生成新的dom newInstance，diff新老props生成需要更新的updatePayload，直接更新到newInstance(也就是workInProgress.stateNode)上
  //    并根据workInProgress.pendingProps设置newInstance的初始属性，然后将workInProgress的所有子节点对应的dom添加到newInstance的dom结构中
  updateHostComponent = function(
    current: Fiber,
    workInProgress: Fiber,
    type: Type,
    newProps: Props,
    rootContainerInstance: Container,
  ) {
    // 老的dom
    const currentInstance = current.stateNode;
    const oldProps = current.memoizedProps;
    // If there are no effects associated with this node, then none of our children had any updates.
    // This guarantees that we can reuse all of them.
    // workInProgress没有update队列且新老props相同(===)，直接用current.stateNode赋值到workInProgress.stateNode
    const childrenUnchanged = workInProgress.firstEffect === null;
    if (childrenUnchanged && oldProps === newProps) {
      // No changes, just reuse the existing instance.
      // Note that this might release a previous clone.
      workInProgress.stateNode = currentInstance;
      return;
    }
    // 需要回收的stateNode
    const recyclableInstance: Instance = workInProgress.stateNode;
    // 当前上下文context
    const currentHostContext = getHostContext();
    let updatePayload = null;
    if (oldProps !== newProps) {
      // diff新老props拿到需要更新的updatePayload数组
      updatePayload = prepareUpdate(
        recyclableInstance,
        type,
        oldProps,
        newProps,
        rootContainerInstance,
        currentHostContext,
      );
    }
    // 即便oldProps !== newProps，有可能是满足==，而不满足===
    // 所以这里有可能updatePayload为null
    if (childrenUnchanged && updatePayload === null) {
      // No changes, just reuse the existing instance.
      // Note that this might release a previous clone.
      // workInProgress没有update队列并且没有updatePayload
      // 直接用current.stateNode
      workInProgress.stateNode = currentInstance;
      return;
    }
    // 根据老的current.stateNode和新的workInProgress克隆出一个instance
    const newInstance = cloneInstance(
      currentInstance,
      updatePayload,
      type,
      oldProps,
      newProps,
      workInProgress,
      childrenUnchanged,
      recyclableInstance,
    );
    if (
      // 根据workInProgress.pendingProps完成对domElement的设置初始属性
      // 返回是否应该autoFocus
      // finalizeInitialChildren内部会进行react合成事件的添加
      finalizeInitialChildren(
        newInstance,
        type,
        newProps,
        rootContainerInstance,
        currentHostContext,
      )
    ) {
      // 应该autoFocus就给workInProgress标记需要更新
      markUpdate(workInProgress);
    }
    // 将workInProgress.stateNode设置为新的instance
    workInProgress.stateNode = newInstance;
    if (childrenUnchanged) {
      // If there are no other effects in this tree, we need to flag this node as having one.
      // Even though we're not going to use it for anything.
      // Otherwise parents won't know that there are new children to propagate upwards.
      // 即使workInProgress没有update队列，也要给workInProgress标记需要更新
      // 目的是让父workInProgress知道有子workInProgress???
      markUpdate(workInProgress);
    } else {
      // If children might have changed, we have to add them all to the set.
      // workInProgress有update队列
      // 添加workInProgress的子节点对应的dom到newInstance的dom结构中
      appendAllChildren(newInstance, workInProgress, false, false);
    }
  };
  updateHostText = function(
    current: Fiber,
    workInProgress: Fiber,
    oldText: string,
    newText: string,
  ) {
    if (oldText !== newText) {
      // If the text content differs, we'll create a new text instance for it.
      const rootContainerInstance = getRootHostContainer();
      const currentHostContext = getHostContext();
      workInProgress.stateNode = createTextInstance(
        newText,
        rootContainerInstance,
        currentHostContext,
        workInProgress,
      );
      // We'll have to mark it as having an effect, even though we won't use the effect for anything.
      // This lets the parents know that at least one of their children has changed.
      markUpdate(workInProgress);
    } else {
      workInProgress.stateNode = current.stateNode;
    }
  };
} else {
  // No host operations
  updateHostContainer = function(workInProgress: Fiber) {
    // Noop
  };
  updateHostComponent = function(
    current: Fiber,
    workInProgress: Fiber,
    type: Type,
    newProps: Props,
    rootContainerInstance: Container,
  ) {
    // Noop
  };
  updateHostText = function(
    current: Fiber,
    workInProgress: Fiber,
    oldText: string,
    newText: string,
  ) {
    // Noop
  };
}

function cutOffTailIfNeeded(
  renderState: SuspenseListRenderState,
  hasRenderedATailFallback: boolean,
) {
  if (getIsHydrating()) {
    // If we're hydrating, we should consume as many items as we can
    // so we don't leave any behind.
    return;
  }
  switch (renderState.tailMode) {
    case 'hidden': {
      // Any insertions at the end of the tail list after this point
      // should be invisible. If there are already mounted boundaries
      // anything before them are not considered for collapsing.
      // Therefore we need to go through the whole tail to find if
      // there are any.
      let tailNode = renderState.tail;
      let lastTailNode = null;
      while (tailNode !== null) {
        if (tailNode.alternate !== null) {
          lastTailNode = tailNode;
        }
        tailNode = tailNode.sibling;
      }
      // Next we're simply going to delete all insertions after the
      // last rendered item.
      if (lastTailNode === null) {
        // All remaining items in the tail are insertions.
        renderState.tail = null;
      } else {
        // Detach the insertion after the last node that was already
        // inserted.
        lastTailNode.sibling = null;
      }
      break;
    }
    case 'collapsed': {
      // Any insertions at the end of the tail list after this point
      // should be invisible. If there are already mounted boundaries
      // anything before them are not considered for collapsing.
      // Therefore we need to go through the whole tail to find if
      // there are any.
      let tailNode = renderState.tail;
      let lastTailNode = null;
      while (tailNode !== null) {
        if (tailNode.alternate !== null) {
          lastTailNode = tailNode;
        }
        tailNode = tailNode.sibling;
      }
      // Next we're simply going to delete all insertions after the
      // last rendered item.
      if (lastTailNode === null) {
        // All remaining items in the tail are insertions.
        if (!hasRenderedATailFallback && renderState.tail !== null) {
          // We suspended during the head. We want to show at least one
          // row at the tail. So we'll keep on and cut off the rest.
          renderState.tail.sibling = null;
        } else {
          renderState.tail = null;
        }
      } else {
        // Detach the insertion after the last node that was already
        // inserted.
        lastTailNode.sibling = null;
      }
      break;
    }
  }
}

// 这里的工作是处理与dom相关的更新替换，将workInProgress转变为真实dom
// 让workInProgress.stateNode更新为最新的dom(复用或者新创建)，并完成整个dom的子dom结构
// 处理dom结构，workInProgress的stateNode指向最新的dom，并且有最新的子dom
// 1. 复用dom current.stateNode作为workInProgress.stateNode
// 2. 或者生成新的dom newInstance，diff新老props生成需要更新的updatePayload，直接更新到newInstance(也就是workInProgress.stateNode)上
//    并根据workInProgress.pendingProps设置newInstance的初始属性，然后将workInProgress的所有子节点对应的dom添加到newInstance的dom结构中
function completeWork(
  current: Fiber | null, // currentFiber
  workInProgress: Fiber, // workInProgress
  renderLanes: Lanes,
): Fiber | null {
  const newProps = workInProgress.pendingProps;

  // 根据workInProgress的tag分别处理
  switch (workInProgress.tag) {
    case IndeterminateComponent:
    case LazyComponent:
    case SimpleMemoComponent:
    case FunctionComponent:
    case ForwardRef:
    case Fragment:
    case Mode:
    case Profiler:
    case ContextConsumer:
    case MemoComponent:
      return null;
    case ClassComponent: {
      // 类组件
      const Component = workInProgress.type;
      if (isLegacyContextProvider(Component)) {
        popLegacyContext(workInProgress);
      }
      return null;
    }
    case HostRoot: {
      // 根
      // 1. 复用
      // 2. 更新newChildSet作为fiberRoot.pendingChildren，将workInProgress的子节点对应的dom的node添加到newChildSet
      //    在全局roots中添加key-value  fiberRoot.containerInfo-fiberRoot.pendingChildren

      // 取出栈中的最后一个context contextFiber rootInstance作为当前的，然后清除栈中对应的
      popHostContainer(workInProgress);
      // 取出栈中的最后一个didPerformWork context作为当前的，然后清除栈中对应的
      popTopLevelLegacyContextObject(workInProgress);
      // 重置workInProgressSources
      resetMutableSourceWorkInProgressVersions();
      // 根workInProgress的stateNode指向fiberRoot
      // fiberRoot对应rootFiber
      const fiberRoot = (workInProgress.stateNode: FiberRoot);
      // 将fiberRoot的context替换为pendingContext
      if (fiberRoot.pendingContext) {
        fiberRoot.context = fiberRoot.pendingContext;
        fiberRoot.pendingContext = null;
      }
      if (current === null || current.child === null) {
        // If we hydrated, pop so that we can delete any remaining children
        // that weren't hydrated.
        const wasHydrated = popHydrationState(workInProgress);
        if (wasHydrated) {
          // If we hydrated, then we'll need to schedule an update for
          // the commit side-effects on the root.
          // workInProgress标记更新
          markUpdate(workInProgress);
        } else if (!fiberRoot.hydrate) {
          // Schedule an effect to clear this container at the start of the next commit.
          // This handles the case of React rendering into a container with previous children.
          // It's also safe to do for updates too, because current.child would only be null
          // if the previous render was null (so the the container would already be empty).
          workInProgress.flags |= Snapshot;
        }
      }
      // 1. 复用
      // 2. 更新newChildSet作为fiberRoot.pendingChildren，将workInProgress的子节点对应的dom的node添加到newChildSet
      //    在全局roots中添加key-value  fiberRoot.containerInfo-fiberRoot.pendingChildren
      updateHostContainer(workInProgress);
      return null;
    }
    case HostComponent: {
      // 原生dom fiber，更新workInProgress.stateNode为最新的dom(复用或者新创建)
      // 这里的工作是diff props初始化dom属性，完成整个dom的子dom结构

      // 取出栈中最上面的context和contextFiber设为当前值，并将栈中赋值为null
      popHostContext(workInProgress);
      // 当前rootInstance容器
      const rootContainerInstance = getRootHostContainer();
      const type = workInProgress.type;
      if (current !== null && workInProgress.stateNode != null) {
        // 更新
        // 处理dom结构
        // workInProgress的stateNode指向最新的dom，并且有最新的子dom
        // 里面有diff新老props，然后直接初始化对应属性到新的dom上
        // 处理dom结构，workInProgress的stateNode指向最新的dom，并且有最新的子dom
        // 1. 复用dom current.stateNode作为workInProgress.stateNode
        // 2. 或者生成新的dom newInstance，diff新老props生成需要更新的updatePayload，直接更新到newInstance(也就是workInProgress.stateNode)上
        //    并根据workInProgress.pendingProps设置newInstance的初始属性，然后将workInProgress的所有子节点对应的dom添加到newInstance的dom结构中
        updateHostComponent(
          current,
          workInProgress,
          type,
          newProps,
          rootContainerInstance,
        );

        if (current.ref !== workInProgress.ref) {
          // workInProgress标记ref
          // 在updateHostComponent时已经标记过了
          markRef(workInProgress);
        }
      } else {
        // 不更新复用，直接创建新的，current为null或者workInProgress.stateNode为null
        // workInProgress的stateNode指向新创建的dom，并且有最新的子dom，初始化了属性
        if (!newProps) {
          invariant(
            workInProgress.stateNode !== null,
            'We must have new props for new mounts. This error is likely ' +
              'caused by a bug in React. Please file an issue.',
          );
          // This can happen when we abort work.
          // 中断work???
          return null;
        }

        // 当前上下文context
        const currentHostContext = getHostContext();
        // TODO: Move createInstance to beginWork and keep it on a context
        // "stack" as the parent. Then append children as we go in beginWork
        // or completeWork depending on whether we want to add them top->down or
        // bottom->up. Top->down is faster in IE11.
        const wasHydrated = popHydrationState(workInProgress);
        if (wasHydrated) {
          // TODO: Move this and createInstance step into the beginPhase
          // to consolidate.
          if (
            prepareToHydrateHostInstance(
              workInProgress,
              rootContainerInstance,
              currentHostContext,
            )
          ) {
            // If changes to the hydrated node need to be applied at the
            // commit-phase we mark this as such.
            markUpdate(workInProgress);
          }
        } else {
          // 创建reactElement实例，挂载了workInProgress和newProps
          const instance = createInstance(
            type,
            newProps,
            rootContainerInstance,
            currentHostContext,
            workInProgress,
          );
          
          // 添加workInProgress的子节点对应的dom到instance的dom结构中
          appendAllChildren(instance, workInProgress, false, false);

          // workInProgress的stateNode指向reactElement
          workInProgress.stateNode = instance;

          // Certain renderers require commit-time effects for initial mount.
          // (eg DOM renderer supports auto-focus for certain elements).
          // Make sure such renderers get scheduled for later work.
          if (
            // 根据workInProgress.pendingProps完成对domElement的设置初始属性
            // 返回是否应该autoFocus
            finalizeInitialChildren(
              instance,
              type,
              newProps,
              rootContainerInstance,
              currentHostContext,
            )
          ) {
            // workInProgress标记需要更新
            markUpdate(workInProgress);
          }
        }

        if (workInProgress.ref !== null) {
          // If there is a ref on a host node we need to schedule a callback
          // workInProgress标记ref
          markRef(workInProgress);
        }
      }
      return null;
    }
    case HostText: {
      // 文本fiber，更新workInProgress.stateNode(复用或者新创建)
      // 这里的工作是完成整个dom的子dom结构
      const newText = newProps;
      if (current && workInProgress.stateNode != null) {
        const oldText = current.memoizedProps;
        // If we have an alternate, that means this is an update and we need
        // to schedule a side-effect to do the updates.
        // 新老文本不同，workInProgress标记需要更新
        // 相同，就直接用current.stateNode赋值到workInProgress.stateNode
        updateHostText(current, workInProgress, oldText, newText);
      } else {
        // current为null或者workInProgress.stateNode为null
        // 替换，只能生成新的
        if (typeof newText !== 'string') {
          invariant(
            workInProgress.stateNode !== null,
            'We must have new props for new mounts. This error is likely ' +
              'caused by a bug in React. Please file an issue.',
          );
          // This can happen when we abort work.
        }
        // 获取当前rootInstance容器
        const rootContainerInstance = getRootHostContainer();
        // 获取当前context
        const currentHostContext = getHostContext();
        const wasHydrated = popHydrationState(workInProgress);
        if (wasHydrated) {
          if (prepareToHydrateHostTextInstance(workInProgress)) {
            markUpdate(workInProgress);
          }
        } else {
          // 创建新的文本dom
          workInProgress.stateNode = createTextInstance(
            newText,
            rootContainerInstance,
            currentHostContext,
            workInProgress,
          );
        }
      }
      return null;
    }
    case SuspenseComponent: {
      popSuspenseContext(workInProgress);
      const nextState: null | SuspenseState = workInProgress.memoizedState;

      if (enableSuspenseServerRenderer) {
        if (nextState !== null && nextState.dehydrated !== null) {
          if (current === null) {
            const wasHydrated = popHydrationState(workInProgress);
            invariant(
              wasHydrated,
              'A dehydrated suspense component was completed without a hydrated node. ' +
                'This is probably a bug in React.',
            );
            prepareToHydrateHostSuspenseInstance(workInProgress);
            if (enableSchedulerTracing) {
              markSpawnedWork(OffscreenLane);
            }
            return null;
          } else {
            // We should never have been in a hydration state if we didn't have a current.
            // However, in some of those paths, we might have reentered a hydration state
            // and then we might be inside a hydration state. In that case, we'll need to exit out of it.
            resetHydrationState();
            if ((workInProgress.flags & DidCapture) === NoFlags) {
              // This boundary did not suspend so it's now hydrated and unsuspended.
              workInProgress.memoizedState = null;
            }
            // If nothing suspended, we need to schedule an effect to mark this boundary
            // as having hydrated so events know that they're free to be invoked.
            // It's also a signal to replay events and the suspense callback.
            // If something suspended, schedule an effect to attach retry listeners.
            // So we might as well always mark this.
            workInProgress.flags |= Update;
            return null;
          }
        }
      }

      if ((workInProgress.flags & DidCapture) !== NoFlags) {
        // Something suspended. Re-render with the fallback children.
        workInProgress.lanes = renderLanes;
        // Do not reset the effect list.
        if (
          enableProfilerTimer &&
          (workInProgress.mode & ProfileMode) !== NoMode
        ) {
          transferActualDuration(workInProgress);
        }
        return workInProgress;
      }

      const nextDidTimeout = nextState !== null;
      let prevDidTimeout = false;
      if (current === null) {
        if (workInProgress.memoizedProps.fallback !== undefined) {
          popHydrationState(workInProgress);
        }
      } else {
        const prevState: null | SuspenseState = current.memoizedState;
        prevDidTimeout = prevState !== null;
      }

      if (nextDidTimeout && !prevDidTimeout) {
        // If this subtreee is running in blocking mode we can suspend,
        // otherwise we won't suspend.
        // TODO: This will still suspend a synchronous tree if anything
        // in the concurrent tree already suspended during this render.
        // This is a known bug.
        if ((workInProgress.mode & BlockingMode) !== NoMode) {
          // TODO: Move this back to throwException because this is too late
          // if this is a large tree which is common for initial loads. We
          // don't know if we should restart a render or not until we get
          // this marker, and this is too late.
          // If this render already had a ping or lower pri updates,
          // and this is the first time we know we're going to suspend we
          // should be able to immediately restart from within throwException.
          const hasInvisibleChildContext =
            current === null &&
            workInProgress.memoizedProps.unstable_avoidThisFallback !== true;
          if (
            hasInvisibleChildContext ||
            hasSuspenseContext(
              suspenseStackCursor.current,
              (InvisibleParentSuspenseContext: SuspenseContext),
            )
          ) {
            // If this was in an invisible tree or a new render, then showing
            // this boundary is ok.
            renderDidSuspend();
          } else {
            // Otherwise, we're going to have to hide content so we should
            // suspend for longer if possible.
            renderDidSuspendDelayIfPossible();
          }
        }
      }

      if (supportsPersistence) {
        // TODO: Only schedule updates if not prevDidTimeout.
        if (nextDidTimeout) {
          // If this boundary just timed out, schedule an effect to attach a
          // retry listener to the promise. This flag is also used to hide the
          // primary children.
          workInProgress.flags |= Update;
        }
      }
      if (supportsMutation) {
        // TODO: Only schedule updates if these values are non equal, i.e. it changed.
        if (nextDidTimeout || prevDidTimeout) {
          // If this boundary just timed out, schedule an effect to attach a
          // retry listener to the promise. This flag is also used to hide the
          // primary children. In mutation mode, we also need the flag to
          // *unhide* children that were previously hidden, so check if this
          // is currently timed out, too.
          workInProgress.flags |= Update;
        }
      }
      if (
        enableSuspenseCallback &&
        workInProgress.updateQueue !== null &&
        workInProgress.memoizedProps.suspenseCallback != null
      ) {
        // Always notify the callback
        workInProgress.flags |= Update;
      }
      return null;
    }
    case HostPortal:
      popHostContainer(workInProgress);
      updateHostContainer(workInProgress);
      if (current === null) {
        preparePortalMount(workInProgress.stateNode.containerInfo);
      }
      return null;
    case ContextProvider:
      // Pop provider fiber
      popProvider(workInProgress);
      return null;
    case IncompleteClassComponent: {
      // Same as class component case. I put it down here so that the tags are
      // sequential to ensure this switch is compiled to a jump table.
      const Component = workInProgress.type;
      if (isLegacyContextProvider(Component)) {
        popLegacyContext(workInProgress);
      }
      return null;
    }
    case SuspenseListComponent: {
      popSuspenseContext(workInProgress);

      const renderState: null | SuspenseListRenderState =
        workInProgress.memoizedState;

      if (renderState === null) {
        // We're running in the default, "independent" mode.
        // We don't do anything in this mode.
        return null;
      }

      let didSuspendAlready = (workInProgress.flags & DidCapture) !== NoFlags;

      const renderedTail = renderState.rendering;
      if (renderedTail === null) {
        // We just rendered the head.
        if (!didSuspendAlready) {
          // This is the first pass. We need to figure out if anything is still
          // suspended in the rendered set.

          // If new content unsuspended, but there's still some content that
          // didn't. Then we need to do a second pass that forces everything
          // to keep showing their fallbacks.

          // We might be suspended if something in this render pass suspended, or
          // something in the previous committed pass suspended. Otherwise,
          // there's no chance so we can skip the expensive call to
          // findFirstSuspended.
          const cannotBeSuspended =
            renderHasNotSuspendedYet() &&
            (current === null || (current.flags & DidCapture) === NoFlags);
          if (!cannotBeSuspended) {
            let row = workInProgress.child;
            while (row !== null) {
              const suspended = findFirstSuspended(row);
              if (suspended !== null) {
                didSuspendAlready = true;
                workInProgress.flags |= DidCapture;
                cutOffTailIfNeeded(renderState, false);

                // If this is a newly suspended tree, it might not get committed as
                // part of the second pass. In that case nothing will subscribe to
                // its thennables. Instead, we'll transfer its thennables to the
                // SuspenseList so that it can retry if they resolve.
                // There might be multiple of these in the list but since we're
                // going to wait for all of them anyway, it doesn't really matter
                // which ones gets to ping. In theory we could get clever and keep
                // track of how many dependencies remain but it gets tricky because
                // in the meantime, we can add/remove/change items and dependencies.
                // We might bail out of the loop before finding any but that
                // doesn't matter since that means that the other boundaries that
                // we did find already has their listeners attached.
                const newThennables = suspended.updateQueue;
                if (newThennables !== null) {
                  workInProgress.updateQueue = newThennables;
                  workInProgress.flags |= Update;
                }

                // Rerender the whole list, but this time, we'll force fallbacks
                // to stay in place.
                // Reset the effect list before doing the second pass since that's now invalid.
                if (renderState.lastEffect === null) {
                  workInProgress.firstEffect = null;
                }
                workInProgress.lastEffect = renderState.lastEffect;
                // Reset the child fibers to their original state.
                resetChildFibers(workInProgress, renderLanes);

                // Set up the Suspense Context to force suspense and immediately
                // rerender the children.
                pushSuspenseContext(
                  workInProgress,
                  setShallowSuspenseContext(
                    suspenseStackCursor.current,
                    ForceSuspenseFallback,
                  ),
                );
                return workInProgress.child;
              }
              row = row.sibling;
            }
          }

          if (renderState.tail !== null && now() > getRenderTargetTime()) {
            // We have already passed our CPU deadline but we still have rows
            // left in the tail. We'll just give up further attempts to render
            // the main content and only render fallbacks.
            workInProgress.flags |= DidCapture;
            didSuspendAlready = true;

            cutOffTailIfNeeded(renderState, false);

            // Since nothing actually suspended, there will nothing to ping this
            // to get it started back up to attempt the next item. While in terms
            // of priority this work has the same priority as this current render,
            // it's not part of the same transition once the transition has
            // committed. If it's sync, we still want to yield so that it can be
            // painted. Conceptually, this is really the same as pinging.
            // We can use any RetryLane even if it's the one currently rendering
            // since we're leaving it behind on this node.
            workInProgress.lanes = SomeRetryLane;
            if (enableSchedulerTracing) {
              markSpawnedWork(SomeRetryLane);
            }
          }
        } else {
          cutOffTailIfNeeded(renderState, false);
        }
        // Next we're going to render the tail.
      } else {
        // Append the rendered row to the child list.
        if (!didSuspendAlready) {
          const suspended = findFirstSuspended(renderedTail);
          if (suspended !== null) {
            workInProgress.flags |= DidCapture;
            didSuspendAlready = true;

            // Ensure we transfer the update queue to the parent so that it doesn't
            // get lost if this row ends up dropped during a second pass.
            const newThennables = suspended.updateQueue;
            if (newThennables !== null) {
              workInProgress.updateQueue = newThennables;
              workInProgress.flags |= Update;
            }

            cutOffTailIfNeeded(renderState, true);
            // This might have been modified.
            if (
              renderState.tail === null &&
              renderState.tailMode === 'hidden' &&
              !renderedTail.alternate &&
              !getIsHydrating() // We don't cut it if we're hydrating.
            ) {
              // We need to delete the row we just rendered.
              // Reset the effect list to what it was before we rendered this
              // child. The nested children have already appended themselves.
              const lastEffect = (workInProgress.lastEffect =
                renderState.lastEffect);
              // Remove any effects that were appended after this point.
              if (lastEffect !== null) {
                lastEffect.nextEffect = null;
              }
              // We're done.
              return null;
            }
          } else if (
            // The time it took to render last row is greater than the remaining
            // time we have to render. So rendering one more row would likely
            // exceed it.
            now() * 2 - renderState.renderingStartTime >
              getRenderTargetTime() &&
            renderLanes !== OffscreenLane
          ) {
            // We have now passed our CPU deadline and we'll just give up further
            // attempts to render the main content and only render fallbacks.
            // The assumption is that this is usually faster.
            workInProgress.flags |= DidCapture;
            didSuspendAlready = true;

            cutOffTailIfNeeded(renderState, false);

            // Since nothing actually suspended, there will nothing to ping this
            // to get it started back up to attempt the next item. While in terms
            // of priority this work has the same priority as this current render,
            // it's not part of the same transition once the transition has
            // committed. If it's sync, we still want to yield so that it can be
            // painted. Conceptually, this is really the same as pinging.
            // We can use any RetryLane even if it's the one currently rendering
            // since we're leaving it behind on this node.
            workInProgress.lanes = SomeRetryLane;
            if (enableSchedulerTracing) {
              markSpawnedWork(SomeRetryLane);
            }
          }
        }
        if (renderState.isBackwards) {
          // The effect list of the backwards tail will have been added
          // to the end. This breaks the guarantee that life-cycles fire in
          // sibling order but that isn't a strong guarantee promised by React.
          // Especially since these might also just pop in during future commits.
          // Append to the beginning of the list.
          renderedTail.sibling = workInProgress.child;
          workInProgress.child = renderedTail;
        } else {
          const previousSibling = renderState.last;
          if (previousSibling !== null) {
            previousSibling.sibling = renderedTail;
          } else {
            workInProgress.child = renderedTail;
          }
          renderState.last = renderedTail;
        }
      }

      if (renderState.tail !== null) {
        // We still have tail rows to render.
        // Pop a row.
        const next = renderState.tail;
        renderState.rendering = next;
        renderState.tail = next.sibling;
        renderState.lastEffect = workInProgress.lastEffect;
        renderState.renderingStartTime = now();
        next.sibling = null;

        // Restore the context.
        // TODO: We can probably just avoid popping it instead and only
        // setting it the first time we go from not suspended to suspended.
        let suspenseContext = suspenseStackCursor.current;
        if (didSuspendAlready) {
          suspenseContext = setShallowSuspenseContext(
            suspenseContext,
            ForceSuspenseFallback,
          );
        } else {
          suspenseContext = setDefaultShallowSuspenseContext(suspenseContext);
        }
        pushSuspenseContext(workInProgress, suspenseContext);
        // Do a pass over the next row.
        return next;
      }
      return null;
    }
    case FundamentalComponent: {
      if (enableFundamentalAPI) {
        const fundamentalImpl = workInProgress.type.impl;
        let fundamentalInstance: ReactFundamentalComponentInstance<
          any,
          any,
        > | null = workInProgress.stateNode;

        if (fundamentalInstance === null) {
          const getInitialState = fundamentalImpl.getInitialState;
          let fundamentalState;
          if (getInitialState !== undefined) {
            fundamentalState = getInitialState(newProps);
          }
          fundamentalInstance = workInProgress.stateNode = createFundamentalStateInstance(
            workInProgress,
            newProps,
            fundamentalImpl,
            fundamentalState || {},
          );
          const instance = ((getFundamentalComponentInstance(
            fundamentalInstance,
          ): any): Instance);
          fundamentalInstance.instance = instance;
          if (fundamentalImpl.reconcileChildren === false) {
            return null;
          }
          appendAllChildren(instance, workInProgress, false, false);
          mountFundamentalComponent(fundamentalInstance);
        } else {
          // We fire update in commit phase
          const prevProps = fundamentalInstance.props;
          fundamentalInstance.prevProps = prevProps;
          fundamentalInstance.props = newProps;
          fundamentalInstance.currentFiber = workInProgress;
          if (supportsPersistence) {
            const instance = cloneFundamentalInstance(fundamentalInstance);
            fundamentalInstance.instance = instance;
            appendAllChildren(instance, workInProgress, false, false);
          }
          const shouldUpdate = shouldUpdateFundamentalComponent(
            fundamentalInstance,
          );
          if (shouldUpdate) {
            markUpdate(workInProgress);
          }
        }
        return null;
      }
      break;
    }
    case ScopeComponent: {
      if (enableScopeAPI) {
        if (current === null) {
          const scopeInstance: ReactScopeInstance = createScopeInstance();
          workInProgress.stateNode = scopeInstance;
          prepareScopeUpdate(scopeInstance, workInProgress);
          if (workInProgress.ref !== null) {
            markRef(workInProgress);
            markUpdate(workInProgress);
          }
        } else {
          if (workInProgress.ref !== null) {
            markUpdate(workInProgress);
          }
          if (current.ref !== workInProgress.ref) {
            markRef(workInProgress);
          }
        }
        return null;
      }
      break;
    }
    case Block:
      if (enableBlocksAPI) {
        return null;
      }
      break;
    case OffscreenComponent:
    case LegacyHiddenComponent: {
      popRenderLanes(workInProgress);
      if (current !== null) {
        const nextState: OffscreenState | null = workInProgress.memoizedState;
        const prevState: OffscreenState | null = current.memoizedState;

        const prevIsHidden = prevState !== null;
        const nextIsHidden = nextState !== null;
        if (
          prevIsHidden !== nextIsHidden &&
          newProps.mode !== 'unstable-defer-without-hiding'
        ) {
          workInProgress.flags |= Update;
        }
      }
      return null;
    }
  }
  invariant(
    false,
    'Unknown unit of work tag (%s). This error is likely caused by a bug in ' +
      'React. Please file an issue.',
    workInProgress.tag,
  );
}

export {completeWork};
