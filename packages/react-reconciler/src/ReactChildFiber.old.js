/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactElement} from 'shared/ReactElementType';
import type {ReactPortal} from 'shared/ReactTypes';
import type {BlockComponent} from 'react/src/ReactBlock';
import type {LazyComponent} from 'react/src/ReactLazy';
import type {Fiber} from './ReactInternalTypes';
import type {Lanes} from './ReactFiberLane';

import getComponentName from 'shared/getComponentName';
import {Placement, Deletion} from './ReactFiberFlags';
import {
  getIteratorFn,
  REACT_ELEMENT_TYPE,
  REACT_FRAGMENT_TYPE,
  REACT_PORTAL_TYPE,
  REACT_LAZY_TYPE,
  REACT_BLOCK_TYPE,
} from 'shared/ReactSymbols';
import {
  FunctionComponent,
  ClassComponent,
  HostText,
  HostPortal,
  ForwardRef,
  Fragment,
  SimpleMemoComponent,
  Block,
} from './ReactWorkTags';
import invariant from 'shared/invariant';
import {
  warnAboutStringRefs,
  enableBlocksAPI,
  enableLazyElements,
} from 'shared/ReactFeatureFlags';

import {
  createWorkInProgress,
  resetWorkInProgress,
  createFiberFromElement,
  createFiberFromFragment,
  createFiberFromText,
  createFiberFromPortal,
} from './ReactFiber.old';
import {emptyRefsObject} from './ReactFiberClassComponent.old';
import {isCompatibleFamilyForHotReloading} from './ReactFiberHotReloading.old';
import {StrictMode} from './ReactTypeOfMode';

let didWarnAboutMaps;
let didWarnAboutGenerators;
let didWarnAboutStringRefs;
let ownerHasKeyUseWarning;
let ownerHasFunctionTypeWarning;
let warnForMissingKey = (child: mixed, returnFiber: Fiber) => {};

if (__DEV__) {
  didWarnAboutMaps = false;
  didWarnAboutGenerators = false;
  didWarnAboutStringRefs = {};

  /**
   * Warn if there's no key explicitly set on dynamic arrays of children or
   * object keys are not valid. This allows us to keep track of children between
   * updates.
   */
  ownerHasKeyUseWarning = {};
  ownerHasFunctionTypeWarning = {};

  warnForMissingKey = (child: mixed, returnFiber: Fiber) => {
    if (child === null || typeof child !== 'object') {
      return;
    }
    if (!child._store || child._store.validated || child.key != null) {
      return;
    }
    invariant(
      typeof child._store === 'object',
      'React Component in warnForMissingKey should have a _store. ' +
        'This error is likely caused by a bug in React. Please file an issue.',
    );
    child._store.validated = true;

    const componentName = getComponentName(returnFiber.type) || 'Component';

    if (ownerHasKeyUseWarning[componentName]) {
      return;
    }
    ownerHasKeyUseWarning[componentName] = true;

    console.error(
      'Each child in a list should have a unique ' +
        '"key" prop. See https://reactjs.org/link/warning-keys for ' +
        'more information.',
    );
  };
}

const isArray = Array.isArray;

// 返回null function object
// element._owner.stateNode.refs存放了所有ref  key-value
function coerceRef(
  returnFiber: Fiber, // 父fiber
  current: Fiber | null, // 老fiber
  element: ReactElement, // 新的reactElement
) {
  const mixedRef = element.ref;
  if (
    mixedRef !== null &&
    typeof mixedRef !== 'function' &&
    typeof mixedRef !== 'object'
  ) {
    if (__DEV__) {
      // TODO: Clean this up once we turn on the string ref warning for
      // everyone, because the strict mode case will no longer be relevant
      if (
        (returnFiber.mode & StrictMode || warnAboutStringRefs) &&
        // We warn in ReactElement.js if owner and self are equal for string refs
        // because these cannot be automatically converted to an arrow function
        // using a codemod. Therefore, we don't have to warn about string refs again.
        !(
          element._owner &&
          element._self &&
          element._owner.stateNode !== element._self
        )
      ) {
        const componentName = getComponentName(returnFiber.type) || 'Component';
        if (!didWarnAboutStringRefs[componentName]) {
          if (warnAboutStringRefs) {
            console.error(
              'Component "%s" contains the string ref "%s". Support for string refs ' +
                'will be removed in a future major release. We recommend using ' +
                'useRef() or createRef() instead. ' +
                'Learn more about using refs safely here: ' +
                'https://reactjs.org/link/strict-mode-string-ref',
              componentName,
              mixedRef,
            );
          } else {
            console.error(
              'A string ref, "%s", has been found within a strict mode tree. ' +
                'String refs are a source of potential bugs and should be avoided. ' +
                'We recommend using useRef() or createRef() instead. ' +
                'Learn more about using refs safely here: ' +
                'https://reactjs.org/link/strict-mode-string-ref',
              mixedRef,
            );
          }
          didWarnAboutStringRefs[componentName] = true;
        }
      }
    }

    if (element._owner) {
      const owner: ?Fiber = (element._owner: any);
      let inst;
      if (owner) {
        const ownerFiber = ((owner: any): Fiber);
        invariant(
          ownerFiber.tag === ClassComponent,
          'Function components cannot have string refs. ' +
            'We recommend using useRef() instead. ' +
            'Learn more about using refs safely here: ' +
            'https://reactjs.org/link/strict-mode-string-ref',
        );
        inst = ownerFiber.stateNode;
      }
      invariant(
        inst,
        'Missing owner for string ref %s. This error is likely caused by a ' +
          'bug in React. Please file an issue.',
        mixedRef,
      );
      const stringRef = '' + mixedRef;
      // Check if previous string ref matches new string ref
      if (
        current !== null &&
        current.ref !== null &&
        typeof current.ref === 'function' &&
        current.ref._stringRef === stringRef
      ) {
        return current.ref;
      }
      const ref = function (value) {
        let refs = inst.refs;
        if (refs === emptyRefsObject) {
          // This is a lazy pooled frozen object, so we need to initialize.
          refs = inst.refs = {};
        }
        if (value === null) {
          delete refs[stringRef];
        } else {
          refs[stringRef] = value;
        }
      };
      ref._stringRef = stringRef;
      return ref;
    } else {
      invariant(
        typeof mixedRef === 'string',
        'Expected ref to be a function, a string, an object returned by React.createRef(), or null.',
      );
      invariant(
        element._owner,
        'Element ref was specified as a string (%s) but no owner was set. This could happen for one of' +
          ' the following reasons:\n' +
          '1. You may be adding a ref to a function component\n' +
          "2. You may be adding a ref to a component that was not created inside a component's render method\n" +
          '3. You have multiple copies of React loaded\n' +
          'See https://reactjs.org/link/refs-must-have-owner for more information.',
        mixedRef,
      );
    }
  }
  return mixedRef;
}

// 如果父fiber的type为富文本，报错
function throwOnInvalidObjectType(returnFiber: Fiber, newChild: Object) {
  if (returnFiber.type !== 'textarea') {
    invariant(
      false,
      'Objects are not valid as a React child (found: %s). ' +
        'If you meant to render a collection of children, use an array ' +
        'instead.',
      Object.prototype.toString.call(newChild) === '[object Object]'
        ? 'object with keys {' + Object.keys(newChild).join(', ') + '}'
        : newChild,
    );
  }
}

function warnOnFunctionType(returnFiber: Fiber) {
  if (__DEV__) {
    const componentName = getComponentName(returnFiber.type) || 'Component';

    if (ownerHasFunctionTypeWarning[componentName]) {
      return;
    }
    ownerHasFunctionTypeWarning[componentName] = true;

    console.error(
      'Functions are not valid as a React child. This may happen if ' +
        'you return a Component instead of <Component /> from render. ' +
        'Or maybe you meant to call this function rather than return it.',
    );
  }
}

// We avoid inlining this to avoid potential deopts from using try/catch.
/** @noinline */
function resolveLazyType<T, P>(
  lazyComponent: LazyComponent<T, P>,
): LazyComponent<T, P> | T {
  try {
    // If we can, let's peek at the resulting type.
    const payload = lazyComponent._payload;
    const init = lazyComponent._init;
    return init(payload);
  } catch (x) {
    // Leave it in place and let it throw again in the begin phase.
    return lazyComponent;
  }
}

// This wrapper function exists because I expect to clone the code in each path
// to be able to optimize each path individually by branching early. This needs
// a compiler or we can do it manually. Helpers that don't need this branching
// live outside of this function.
// shouldTrackSideEffects  true——更新复用  false——替换新的
function ChildReconciler(shouldTrackSideEffects) {
  // 标记childToDelete为需要删除的fiber，并放在returnFiber的最后一个effect上
  // 在执行到childToDelete对应的effect时，将其移除
  function deleteChild(returnFiber: Fiber, childToDelete: Fiber): void {
    if (!shouldTrackSideEffects) {
      // Noop.
      return;
    }
    // Deletions are added in reversed order so we add it to the front.
    // At this point, the return fiber's effect list is empty except for
    // deletions, so we can just append the deletion to the list. The remaining
    // effects aren't added until the complete phase. Once we implement
    // resuming, this may not be true.
    // returnFiber的最后一个update
    const last = returnFiber.lastEffect;
    if (last !== null) {
      // 有effect队列，将childToDelete设置为最后一个effect
      last.nextEffect = childToDelete;
      returnFiber.lastEffect = childToDelete;
    } else {
      // 没有effect队列，将childToDelete设置为唯一的一个effect
      returnFiber.firstEffect = returnFiber.lastEffect = childToDelete;
    }
    // childToDelete为最后一个effect，自然没有nextEffect
    childToDelete.nextEffect = null;
    // 当执行到childToDelete这个effect时，根据这个Deletion做删除操作
    // 设置这个flags，表示当前fiber(也就是childToDelete)有副作用，需要添加到自身effect list的最后
    childToDelete.flags = Deletion;
  }

  // 将父currentFiber中需要删除的第一个fiber及其之后的所有子fiber标记为需要删除的fiber，并添加到父workInProgress的effect list副作用单链表中
  // 同时给这些需要删除的fiber添加flags，completeUnitOfWork时会将自身添加到父workInProgress的effect list的最后(effect list中的顺序是先子后父)
  // 等到commit的时候统一进行副作用(也就是dom更新)处理
  function deleteRemainingChildren(
    returnFiber: Fiber, // 父workInProgress
    currentFirstChild: Fiber | null, // 父currentFiber中需要删除的第一个子fiber
  ): null {
    if (!shouldTrackSideEffects) {
      // Noop.
      return null;
    }

    // TODO: For the shouldClone case, this could be micro-optimized a bit by
    // assuming that after the first child we've already added everything.
    // 将父currentFiber中需要删除的第一个fiber及其之后的所有子fiber标记为需要删除的fiber，并添加到父workInProgress的effect list副作用单链表中
    // 同时给这些需要删除的fiber添加flags，completeUnitOfWork时会将自身添加到父workInProgress的effect list的最后(effect list中的顺序是先子后父)
    // 等到commit的时候统一进行副作用(也就是dom更新)处理
    let childToDelete = currentFirstChild;
    while (childToDelete !== null) {
      deleteChild(returnFiber, childToDelete);
      childToDelete = childToDelete.sibling;
    }
    return null;
  }

  // 从开头第一个不可复用的老currentFiber开始，构建existingChildren的map结构，用于第二轮遍历
  // key为fiber的 key/index，value为fiber
  function mapRemainingChildren(
    returnFiber: Fiber, // 父fiber
    currentFirstChild: Fiber, // 开头第一个不可复用的老currentFiber
  ): Map<string | number, Fiber> {
    // Add the remaining children to a temporary map so that we can find them by
    // keys quickly. Implicit (null) keys get added to this set with their index
    // instead.
    // 从开头第一个不可复用的老currentFiber开始，构建existingChildren的map结构
    // key为fiber的 key/index，value为fiber
    const existingChildren: Map<string | number, Fiber> = new Map();

    let existingChild = currentFirstChild;
    while (existingChild !== null) {
      if (existingChild.key !== null) {
        // 以key作为map的key
        existingChildren.set(existingChild.key, existingChild);
      } else {
        // 以index作为map的key
        existingChildren.set(existingChild.index, existingChild);
      }
      existingChild = existingChild.sibling;
    }
    return existingChildren;
  }

  // 更新fiber，返回fiber对应的workInProgress
  function useFiber(fiber: Fiber, pendingProps: mixed): Fiber {
    // We currently set sibling to null and index to 0 here because it is easy
    // to forget to do before returning it. E.g. for the single child case.
    const clone = createWorkInProgress(fiber, pendingProps);
    clone.index = 0;
    clone.sibling = null;
    return clone;
  }

  // 判断新workInProgress是否需要移动，对需要移动的workInProgress添加flags为Placement
  // 根据上一个workInProgress的位置index获取当前workInProgress的位置index
  // 如果是新创建的或是需要移动的，标记Placement，不修改lastPlacedIndex
  // abc => bdeca
  // ade需要移动，bc不需要移动
  function placeChild(
    newFiber: Fiber, // 新workInProgress
    lastPlacedIndex: number,
    newIndex: number,
  ): number {
    newFiber.index = newIndex;
    if (!shouldTrackSideEffects) {
      // Noop.
      return lastPlacedIndex;
    }
    const current = newFiber.alternate;
    if (current !== null) {
      // 复用
      const oldIndex = current.index;
      if (oldIndex < lastPlacedIndex) {
        // This is a move.
        // 位置变动，移动
        // 标记新workInProgress需要移动
        newFiber.flags = Placement;
        return lastPlacedIndex;
      } else {
        // This item can stay in place.
        // 位置不变
        return oldIndex;
      }
    } else {
      // This is an insertion.
      // 替换
      // 标记新workInProgress需要移动
      newFiber.flags = Placement;
      return lastPlacedIndex;
    }
  }

  // newFiber  子workInProgress(复用的或是新创新的)
  // 对新创建的workInProgress(老的alternate指向currentFiber，新的alternate为null)添加flags为Placement
  // 等到completeUnitOfWork时会将自身添加到父workInProgress的effect list最后，表示有副作用更新
  function placeSingleChild(newFiber: Fiber): Fiber {
    // This is simpler for the single child case. We only need to do a
    // placement for inserting new children.
    if (shouldTrackSideEffects && newFiber.alternate === null) {
      // newFiber是新创建的，就标记Placement
      // newFiber是复用的，原本就有位置，不需要标记Placement
      newFiber.flags = Placement;
    }
    return newFiber;
  }

  // 更新文本fiber，返回新的或者更新过的workInProgress
  function updateTextNode(
    returnFiber: Fiber, // 父fiber
    current: Fiber | null, // 老fiber
    textContent: string, // 新的文本
    lanes: Lanes,
  ) {
    if (current === null || current.tag !== HostText) {
      // Insert
      // 没有老fiber，或者老fiber不是原生dom节点
      // 创建新的文本fiber返回
      const created = createFiberFromText(textContent, returnFiber.mode, lanes);
      created.return = returnFiber;
      return created;
    } else {
      // Update
      // 更新fiber，返回currentFiber对应的workInProgress
      const existing = useFiber(current, textContent);
      existing.return = returnFiber;
      return existing;
    }
  }
  // 返回新的或者更新过的reactElement workInProgress
  function updateElement(
    returnFiber: Fiber,
    current: Fiber | null,
    element: ReactElement,
    lanes: Lanes,
  ): Fiber {
    // 老的currentFiber存在就复用老的workInProgress
    if (current !== null) {
      if (
        current.elementType === element.type ||
        // Keep this check inline so it only runs on the false path:
        (__DEV__ ? isCompatibleFamilyForHotReloading(current, element) : false)
      ) {
        // Move based on index
        // elementType相同，更新老的workInProgress并返回
        const existing = useFiber(current, element.props);
        // 返回null function object
        existing.ref = coerceRef(returnFiber, current, element);
        existing.return = returnFiber;
        if (__DEV__) {
          existing._debugSource = element._source;
          existing._debugOwner = element._owner;
        }
        return existing;
      } else if (enableBlocksAPI && current.tag === Block) {
        // The new Block might not be initialized yet. We need to initialize
        // it in case initializing it turns out it would match.
        // elementType不相同且老fiber的type为Block
        let type = element.type;
        // 新fiber为懒加载fiber
        if (type.$$typeof === REACT_LAZY_TYPE) {
          // type = type._init(type._payload)
          type = resolveLazyType(type);
        }
        if (
          type.$$typeof === REACT_BLOCK_TYPE &&
          ((type: any): BlockComponent<any, any>)._render ===
            (current.type: BlockComponent<any, any>)._render
        ) {
          // 新fiber是block组件且新老type的render相同，更新老的workInProgress
          // Same as above but also update the .type field.
          const existing = useFiber(current, element.props);
          existing.return = returnFiber;
          existing.type = type;
          if (__DEV__) {
            existing._debugSource = element._source;
            existing._debugOwner = element._owner;
          }
          return existing;
        }
      }
    }
    // Insert
    // 老的currentFiber不存在，创建的新的workInProgress返回
    const created = createFiberFromElement(element, returnFiber.mode, lanes);
    created.ref = coerceRef(returnFiber, current, element);
    created.return = returnFiber;
    return created;
  }

  // 返回新的或者更新过的portal workInProgress
  function updatePortal(
    returnFiber: Fiber,
    current: Fiber | null,
    portal: ReactPortal,
    lanes: Lanes,
  ): Fiber {
    if (
      current === null ||
      current.tag !== HostPortal ||
      current.stateNode.containerInfo !== portal.containerInfo ||
      current.stateNode.implementation !== portal.implementation
    ) {
      // Insert
      // 创建新的
      const created = createFiberFromPortal(portal, returnFiber.mode, lanes);
      created.return = returnFiber;
      return created;
    } else {
      // Update
      // 更新复用
      const existing = useFiber(current, portal.children || []);
      existing.return = returnFiber;
      return existing;
    }
  }

  // 返回新的或者更新过的fragment workInProgress
  function updateFragment(
    returnFiber: Fiber,
    current: Fiber | null,
    fragment: Iterable<*>,
    lanes: Lanes,
    key: null | string,
  ): Fiber {
    if (current === null || current.tag !== Fragment) {
      // Insert
      const created = createFiberFromFragment(
        fragment,
        returnFiber.mode,
        lanes,
        key,
      );
      created.return = returnFiber;
      return created;
    } else {
      // Update
      const existing = useFiber(current, fragment);
      existing.return = returnFiber;
      return existing;
    }
  }

  // 创建子workInProgress
  // 流程和updateSlot一致，区别是updateSlot需要判断是否可复用，而这里无需判断，都是创建新的
  function createChild(
    returnFiber: Fiber,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    if (typeof newChild === 'string' || typeof newChild === 'number') {
      // Text nodes don't have keys. If the previous node is implicitly keyed
      // we can continue to replace it without aborting even if it is not a text
      // node.
      const created = createFiberFromText(
        '' + newChild,
        returnFiber.mode,
        lanes,
      );
      created.return = returnFiber;
      return created;
    }

    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          const created = createFiberFromElement(
            newChild,
            returnFiber.mode,
            lanes,
          );
          created.ref = coerceRef(returnFiber, null, newChild);
          created.return = returnFiber;
          return created;
        }
        case REACT_PORTAL_TYPE: {
          const created = createFiberFromPortal(
            newChild,
            returnFiber.mode,
            lanes,
          );
          created.return = returnFiber;
          return created;
        }
        case REACT_LAZY_TYPE: {
          if (enableLazyElements) {
            const payload = newChild._payload;
            const init = newChild._init;
            return createChild(returnFiber, init(payload), lanes);
          }
        }
      }

      if (isArray(newChild) || getIteratorFn(newChild)) {
        const created = createFiberFromFragment(
          newChild,
          returnFiber.mode,
          lanes,
          null,
        );
        created.return = returnFiber;
        return created;
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber);
      }
    }

    return null;
  }

  // 对比新老currentFiber，创建新的或者更新过老的workInProgress并返回
  function updateSlot(
    returnFiber: Fiber, // 父fiber
    oldFiber: Fiber | null, // 老的fiber
    newChild: any, // 新的fiber
    lanes: Lanes,
  ): Fiber | null {
    // Update the fiber if the keys match, otherwise return null.
    // 如果key匹配，更新fiber，否则返回null

    // 获取老fiber的key
    const key = oldFiber !== null ? oldFiber.key : null;

    // 新fiber是string或number，也就是文本fiber
    // 如果有老key，直接返回null，做替换
    // 如果没有老key，更新老fiber
    if (typeof newChild === 'string' || typeof newChild === 'number') {
      // Text nodes don't have keys. If the previous node is implicitly keyed
      // we can continue to replace it without aborting even if it is not a text
      // node.
      // 文本节点不应该存在key
      if (key !== null) {
        return null;
      }
      // 更新文本fiber，返回新的或者更新过的workInProgress
      return updateTextNode(returnFiber, oldFiber, '' + newChild, lanes);
    }

    // newChild为对象
    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          // reactElement
          if (newChild.key === key) {
            // 新老key相同，同级更新复用
            if (newChild.type === REACT_FRAGMENT_TYPE) {
              // fragment
              // 返回新的或者更新过的fragment workInProgress
              return updateFragment(
                returnFiber,
                oldFiber,
                newChild.props.children,
                lanes,
                key,
              );
            }
            // reactElement
            // 返回新的或者更新过的workInProgress
            return updateElement(returnFiber, oldFiber, newChild, lanes);
          } else {
            // 新老key不同，直接返回null
            return null;
          }
        }
        case REACT_PORTAL_TYPE: {
          // 	Portal
          if (newChild.key === key) {
            // 新老key相同，复用
            // 返回新的或者更新过的portal workInProgress
            return updatePortal(returnFiber, oldFiber, newChild, lanes);
          } else {
            // 新老key不同，直接返回null
            return null;
          }
        }
        case REACT_LAZY_TYPE: {
          // 懒加载组件
          // 在这里生成新的fiber，再进行updateSlot
          if (enableLazyElements) {
            const payload = newChild._payload;
            const init = newChild._init;
            return updateSlot(returnFiber, oldFiber, init(payload), lanes);
          }
        }
      }

      // 如果newChild为数组或是可迭代对象，当作frament处理
      if (isArray(newChild) || getIteratorFn(newChild)) {
        if (key !== null) {
          return null;
        }

        return updateFragment(returnFiber, oldFiber, newChild, lanes, null);
      }

      // 如果父fiber的type为富文本，报错
      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber);
      }
    }

    // 所有可复用情况都判断完毕，依旧没有可复用fiber，返回null
    return null;
  }

  // 第二轮遍历，创建新的子workInProgress，此时existingChildren已经存储了剩下的老currentFiber的map
  // 遍历每一个newChild，直接从existingChildren中找到 key/index 相同的老fiber进行复用，没有就进行创建
  function updateFromMap(
    existingChildren: Map<string | number, Fiber>, // 剩下的老currentFiber的map结构
    returnFiber: Fiber, // 父fiber
    newIdx: number,
    newChild: any, // 剩下的新newChild
    lanes: Lanes,
  ): Fiber | null {
    // 文本节点
    if (typeof newChild === 'string' || typeof newChild === 'number') {
      // Text nodes don't have keys, so we neither have to check the old nor
      // new node for the key. If both are text nodes, they match.
      // 从existingChildren找到可复用的fiber
      const matchedFiber = existingChildren.get(newIdx) || null;
      return updateTextNode(returnFiber, matchedFiber, '' + newChild, lanes);
    }

    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: { // 组件根节点
          // 从existingChildren找到可复用的fiber
          const matchedFiber =
            existingChildren.get(
              newChild.key === null ? newIdx : newChild.key,
            ) || null;
          if (newChild.type === REACT_FRAGMENT_TYPE) {
            return updateFragment(
              returnFiber,
              matchedFiber,
              newChild.props.children,
              lanes,
              newChild.key,
            );
          }
          return updateElement(returnFiber, matchedFiber, newChild, lanes);
        }
        case REACT_PORTAL_TYPE: {
          const matchedFiber =
            existingChildren.get(
              newChild.key === null ? newIdx : newChild.key,
            ) || null;
          return updatePortal(returnFiber, matchedFiber, newChild, lanes);
        }
        case REACT_LAZY_TYPE:
          if (enableLazyElements) {
            const payload = newChild._payload;
            const init = newChild._init;
            return updateFromMap(
              existingChildren,
              returnFiber,
              newIdx,
              init(payload),
              lanes,
            );
          }
      }

      if (isArray(newChild) || getIteratorFn(newChild)) {
        const matchedFiber = existingChildren.get(newIdx) || null;
        return updateFragment(returnFiber, matchedFiber, newChild, lanes, null);
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber);
      }
    }

    return null;
  }

  /**
   * Warns if there is a duplicate or missing key
   */
  function warnOnInvalidKey(
    child: mixed,
    knownKeys: Set<string> | null,
    returnFiber: Fiber,
  ): Set<string> | null {
    if (__DEV__) {
      if (typeof child !== 'object' || child === null) {
        return knownKeys;
      }
      switch (child.$$typeof) {
        case REACT_ELEMENT_TYPE:
        case REACT_PORTAL_TYPE:
          warnForMissingKey(child, returnFiber);
          const key = child.key;
          if (typeof key !== 'string') {
            break;
          }
          if (knownKeys === null) {
            knownKeys = new Set();
            knownKeys.add(key);
            break;
          }
          if (!knownKeys.has(key)) {
            knownKeys.add(key);
            break;
          }
          console.error(
            'Encountered two children with the same key, `%s`. ' +
              'Keys should be unique so that components maintain their identity ' +
              'across updates. Non-unique keys may cause children to be ' +
              'duplicated and/or omitted — the behavior is unsupported and ' +
              'could change in a future version.',
            key,
          );
          break;
        case REACT_LAZY_TYPE:
          if (enableLazyElements) {
            const payload = child._payload;
            const init = (child._init: any);
            warnOnInvalidKey(init(payload), knownKeys, returnFiber);
            break;
          }
        // We intentionally fallthrough here if enableLazyElements is not on.
        // eslint-disable-next-lined no-fallthrough
        default:
          break;
      }
    }
    return knownKeys;
  }

  // 对children做dom diff，生成新的链表，并返回链表的第一个workInProgress
  // 这里会对newChildren中的每一项生成(新创建或复用)newFiber，并设置每一个newFiber的child sibling return
  // 这里会进行两轮遍历，遍历的都是newChildren
  // 第一轮遍历开始，新老index同步，找出开头可复用的fiber
  // 第一轮遍历结束，如果没有newChild，就把剩下的老的删除，如果没有老的，就把剩下的newChild创建
  // 如果新老都存在，说明开头存在index相同且key不同的fiber，需要进行第二轮遍历
  // 第二轮遍历(剩下的newChildren)之前，根据剩下的老fiber生成existingChildren的map结构，key为老fiber的 key/index，value为老fiber，方便第二轮遍历时找到可复用的fiber
  // 第二轮遍历(剩下的newChildren)开始，从existingChildren中找出可复用的fiber进行复用，如果没有，就进行创建
  // 第二轮遍历结束，把existingChildren中剩下的标记删除副作用
  // 删除处理，这里仅仅是标记删除副作用Deletion，且将需要删除的fiber添加到父fiber的effect链表最后
  // 而处理删除副作用的时机是在提交阶段
  // react dom diff的时间复杂度为 O(n)
  function reconcileChildrenArray(
    returnFiber: Fiber, // 父workInProgress
    currentFirstChild: Fiber | null, // 父currentFiber的第一个子fiber
    newChildren: Array<*>, // 新的子fiber数组
    lanes: Lanes,
  ): Fiber | null {
    // This algorithm can't optimize by searching from both ends since we
    // don't have backpointers on fibers. I'm trying to see how far we can get
    // with that model. If it ends up not being worth the tradeoffs, we can
    // add it later.
    // 这个算法不能通过两端指针优化，因为fiber上没有反向指针
    // 以后可能会添加反向指针

    // Even with a two ended optimization, we'd want to optimize for the case
    // where there are few changes and brute force the comparison instead of
    // going for the Map. It'd like to explore hitting that path first in
    // forward-only mode and only go for the Map once we notice that we need
    // lots of look ahead. This doesn't handle reversal as well as two ended
    // search but that's unusual. Besides, for the two ended optimization to
    // work on Iterables, we'd need to copy the whole set.
    // 两端指针优化不一定可行

    // In this first iteration, we'll just live with hitting the bad case
    // (adding everything to a Map) in for every insert/move.

    // If you change this code, also update reconcileChildrenIterator() which
    // uses the same algorithm.
    // 修改这段代码，还是需要执行reconcileChildrenIterator()

    if (__DEV__) {
      // First, validate keys.
      let knownKeys = null;
      for (let i = 0; i < newChildren.length; i++) {
        const child = newChildren[i];
        knownKeys = warnOnInvalidKey(child, knownKeys, returnFiber);
      }
    }

    let resultingFirstChild: Fiber | null = null; // 第一个workInProgress
    let previousNewFiber: Fiber | null = null; // 前一个workInProgress

    let oldFiber = currentFirstChild; // 老的fiber
    let lastPlacedIndex = 0; // 上一个workInProgress对应的位置index
    let newIdx = 0;
    let nextOldFiber = null;
    // 遍历newChildren
    // 生成每一个新的workInProgress(替换/更新)，串联到链表结构中
    // 第一个为resultingFirstChild，后面的通过sibling连接
    // 判断每一个新的workInProgress的位置是否需要移动并标记
    // 是否移动的判断和vue2.x一样
    // 这里为第一轮遍历，找出新老children开头能复用的fiber
    for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
      // 比较新老index
      if (oldFiber.index > newIdx) {
        // 老的index大于新的index，将老fiber往后移一个
        // 当前newChild不参与复用
        nextOldFiber = oldFiber;
        oldFiber = null;
      } else {
        // 老的index小于等于新的index，下一个老fiber正常取oldFiber.sibling
        // 这里的newChild才参与复用判断
        nextOldFiber = oldFiber.sibling;
      }
      // 对比新老currentFiber，获取新的或者更新过老的workInProgress
      // 也有可能返回null
      // oldFiber为null，newFiber也有可能不为null
      // 这里对比了新老key
      const newFiber = updateSlot(
        returnFiber,
        oldFiber,
        newChildren[newIdx],
        lanes,
      );
      if (newFiber === null) {
        // TODO: This breaks on empty slots like null children. That's
        // unfortunate because it triggers the slow path all the time. We need
        // a better way to communicate whether this was a miss or null,
        // boolean, undefined, etc.
        // 新的workInProgress为null，直接跳出循环，无法完成链表结构
        if (oldFiber === null) {
          // 如果oldFiber为null，取nextOldFiber
          oldFiber = nextOldFiber;
        }
        break;
      }
      if (shouldTrackSideEffects) {
        if (oldFiber && newFiber.alternate === null) {
          // We matched the slot, but we didn't reuse the existing fiber, so we
          // need to delete the existing child.
          // 存在老fiber，且新的workInProgress没有对应的currentFiber
          // 说明没有复用，删除老的child
          deleteChild(returnFiber, oldFiber);
        }
      }

      // 判断新workInProgress是否需要移动，对需要移动的workInProgress添加flags为Placement
      // 根据上一个workInProgress的位置index获取当前workInProgress的位置index
      // 如果是新创建的或是需要移动的，标记Placement，不修改lastPlacedIndex
      // lastPlacedIndex由上一个的位置index更新为当前的位置index
      // 第一轮遍历一般都是能复用且不用移动的，这里主要是用于更新lastPlacedIndex
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
      // 设置首个workInProgress和每一个的sibling形成链表结构
      if (previousNewFiber === null) {
        // TODO: Move out of the loop. This only happens for the first run.
        // 第一个子workInProgress
        resultingFirstChild = newFiber;
      } else {
        // TODO: Defer siblings if we're not at the right index for this slot.
        // I.e. if we had null values before, then we want to defer this
        // for each null value. However, we also don't want to call updateSlot
        // with the previous one.
        // 将当前workInProgress挂载到前一个的sibling上
        previousNewFiber.sibling = newFiber;
      }
      // 更新前一个workInProgress为当前workInProgress，下一轮循环需要用
      previousNewFiber = newFiber;
      // 更新老的currentFiber为下一轮循环的currentFiber，执行下一轮循环
      oldFiber = nextOldFiber;
    }

    // newChildren全部遍历，删除剩下的老的currentFiber，直接返回第一个子workInProgress
    if (newIdx === newChildren.length) {
      // We've reached the end of the new children. We can delete the rest.
      // oldFiber及其之后的所有子fiber标记为需要删除的fiber，并添加到父workInProgress(也就是returnFiber)的effect list副作用单链表中
      // 同时给这些需要删除的fiber添加flags，completeUnitOfWork时会将自身添加到父workInProgress的effect list的最后(effect list中的顺序是先子后父)
      // 等到commit的时候统一进行副作用(也就是dom更新)处理
      deleteRemainingChildren(returnFiber, oldFiber);
      return resultingFirstChild;
    }

    // newChildren还没有遍历完，但是老的currentFiber已经没有了
    // 将newChildren剩下的遍历完，完成链表结构和位置判断，再返回第一个子workInProgress
    // 流程与上述newChildren的遍历一致，区别是上面有是否复用的判断，而这里无需判断，都是创建新的
    if (oldFiber === null) {
      // If we don't have any more existing children we can choose a fast path
      // since the rest will all be insertions.
      for (; newIdx < newChildren.length; newIdx++) {
        const newFiber = createChild(returnFiber, newChildren[newIdx], lanes);
        if (newFiber === null) {
          continue;
        }
        // 判断新workInProgress是否需要移动，对需要移动的workInProgress添加flags为Placement
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          // TODO: Move out of the loop. This only happens for the first run.
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
      return resultingFirstChild;
    }

    // Add all children to a key map for quick lookups.
    // 走到这里，只有可能在第一次newChildren的遍历中跳出循环
    // 此时newChildren没有遍历完，且newChild为null，oldFiber不为null
    
    // oldFiber指向开头第一个不可复用的fiber
    // 从开头第一个不可复用的老currentFiber开始，构建existingChildren的map结构，用于第二轮遍历
    // key为fiber的 key/index，value为fiber
    const existingChildren = mapRemainingChildren(returnFiber, oldFiber);

    // Keep scanning and use the map to restore deleted items as moves.
    // 将newChildren剩下的遍历完，完成链表结构和位置判断，再返回第一个子workInProgress
    // 第二轮遍历，这里已经处理完开头可以复用的fiber了
    // 创建新的子workInProgress，此时existingChildren已经存储了剩下的老currentFiber的map
    // 遍历每一个newChild，直接从existingChildren中找到 key/index 相同的老fiber进行复用，没有就进行创建
    for (; newIdx < newChildren.length; newIdx++) {
      // 第二轮遍历，创建新的子workInProgress，此时existingChildren已经存储了剩下的老currentFiber的map
      // 遍历每一个newChild，直接从existingChildren中找到 key/index 相同的老fiber进行复用，没有就进行创建
      const newFiber = updateFromMap(
        existingChildren,
        returnFiber,
        newIdx,
        newChildren[newIdx],
        lanes,
      );
      if (newFiber !== null) {
        if (shouldTrackSideEffects) {
          // 新的workInProgress存在alternate指向currentFiber，说明复用了
          // 直接在existingChildren map中删除保留的currentFiber，这样就不用再将其放到删除列表中了
          if (newFiber.alternate !== null) {
            // The new fiber is a work in progress, but if there exists a
            // current, that means that we reused the fiber. We need to delete
            // it from the child list so that we don't add it to the deletion
            // list.
            existingChildren.delete(
              newFiber.key === null ? newIdx : newFiber.key,
            );
          }
        }
        // 判断新workInProgress是否需要移动，对需要移动的workInProgress添加flags为Placement
        // 根据上一个workInProgress的位置index获取当前workInProgress的位置index
        // 如果是新创建的或是需要移动的，标记Placement，不修改lastPlacedIndex
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        // 形成链表
        if (previousNewFiber === null) {
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
    }

    if (shouldTrackSideEffects) {
      // Any existing children that weren't consumed above were deleted. We need
      // to add them to the deletion list.
      // 将最后一次newChildren的遍历中没有删除掉的老currentFiber(existingChildren中的)做统一删除，添加到删除列表
      existingChildren.forEach((child) => deleteChild(returnFiber, child));
    }

    // 返回链表的第一个workInProgress
    return resultingFirstChild;
  }

  // 逻辑和reconcileChildrenArray一摸一样，只是newChildren由数组变成了迭代器
  // 对children做dom diff，生成新的链表，并返回链表的第一个workInProgress
  function reconcileChildrenIterator(
    returnFiber: Fiber, // 父workInProgress
    currentFirstChild: Fiber | null, // 父currentFiber的第一个子fiber
    newChildrenIterable: Iterable<*>,
    lanes: Lanes,
  ): Fiber | null {
    // This is the same implementation as reconcileChildrenArray(),
    // but using the iterator instead.

    const iteratorFn = getIteratorFn(newChildrenIterable);
    invariant(
      typeof iteratorFn === 'function',
      'An object is not an iterable. This error is likely caused by a bug in ' +
        'React. Please file an issue.',
    );

    if (__DEV__) {
      // We don't support rendering Generators because it's a mutation.
      // See https://github.com/facebook/react/issues/12995
      if (
        typeof Symbol === 'function' &&
        // $FlowFixMe Flow doesn't know about toStringTag
        newChildrenIterable[Symbol.toStringTag] === 'Generator'
      ) {
        if (!didWarnAboutGenerators) {
          console.error(
            'Using Generators as children is unsupported and will likely yield ' +
              'unexpected results because enumerating a generator mutates it. ' +
              'You may convert it to an array with `Array.from()` or the ' +
              '`[...spread]` operator before rendering. Keep in mind ' +
              'you might need to polyfill these features for older browsers.',
          );
        }
        didWarnAboutGenerators = true;
      }

      // Warn about using Maps as children
      if ((newChildrenIterable: any).entries === iteratorFn) {
        if (!didWarnAboutMaps) {
          console.error(
            'Using Maps as children is not supported. ' +
              'Use an array of keyed ReactElements instead.',
          );
        }
        didWarnAboutMaps = true;
      }

      // First, validate keys.
      // We'll get a different iterator later for the main pass.
      const newChildren = iteratorFn.call(newChildrenIterable);
      if (newChildren) {
        let knownKeys = null;
        let step = newChildren.next();
        for (; !step.done; step = newChildren.next()) {
          const child = step.value;
          knownKeys = warnOnInvalidKey(child, knownKeys, returnFiber);
        }
      }
    }

    const newChildren = iteratorFn.call(newChildrenIterable);
    invariant(newChildren != null, 'An iterable object provided no iterator.');

    let resultingFirstChild: Fiber | null = null;
    let previousNewFiber: Fiber | null = null;

    let oldFiber = currentFirstChild;
    let lastPlacedIndex = 0;
    let newIdx = 0;
    let nextOldFiber = null;

    let step = newChildren.next();
    for (
      ;
      oldFiber !== null && !step.done;
      newIdx++, step = newChildren.next()
    ) {
      if (oldFiber.index > newIdx) {
        nextOldFiber = oldFiber;
        oldFiber = null;
      } else {
        nextOldFiber = oldFiber.sibling;
      }
      const newFiber = updateSlot(returnFiber, oldFiber, step.value, lanes);
      if (newFiber === null) {
        // TODO: This breaks on empty slots like null children. That's
        // unfortunate because it triggers the slow path all the time. We need
        // a better way to communicate whether this was a miss or null,
        // boolean, undefined, etc.
        if (oldFiber === null) {
          oldFiber = nextOldFiber;
        }
        break;
      }
      if (shouldTrackSideEffects) {
        if (oldFiber && newFiber.alternate === null) {
          // We matched the slot, but we didn't reuse the existing fiber, so we
          // need to delete the existing child.
          deleteChild(returnFiber, oldFiber);
        }
      }
      // 判断新workInProgress是否需要移动，对需要移动的workInProgress添加flags为Placement
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
      if (previousNewFiber === null) {
        // TODO: Move out of the loop. This only happens for the first run.
        resultingFirstChild = newFiber;
      } else {
        // TODO: Defer siblings if we're not at the right index for this slot.
        // I.e. if we had null values before, then we want to defer this
        // for each null value. However, we also don't want to call updateSlot
        // with the previous one.
        previousNewFiber.sibling = newFiber;
      }
      previousNewFiber = newFiber;
      oldFiber = nextOldFiber;
    }

    if (step.done) {
      // We've reached the end of the new children. We can delete the rest.
      deleteRemainingChildren(returnFiber, oldFiber);
      return resultingFirstChild;
    }

    if (oldFiber === null) {
      // If we don't have any more existing children we can choose a fast path
      // since the rest will all be insertions.
      for (; !step.done; newIdx++, step = newChildren.next()) {
        const newFiber = createChild(returnFiber, step.value, lanes);
        if (newFiber === null) {
          continue;
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          // TODO: Move out of the loop. This only happens for the first run.
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
      return resultingFirstChild;
    }

    // Add all children to a key map for quick lookups.
    const existingChildren = mapRemainingChildren(returnFiber, oldFiber);

    // Keep scanning and use the map to restore deleted items as moves.
    for (; !step.done; newIdx++, step = newChildren.next()) {
      const newFiber = updateFromMap(
        existingChildren,
        returnFiber,
        newIdx,
        step.value,
        lanes,
      );
      if (newFiber !== null) {
        if (shouldTrackSideEffects) {
          if (newFiber.alternate !== null) {
            // The new fiber is a work in progress, but if there exists a
            // current, that means that we reused the fiber. We need to delete
            // it from the child list so that we don't add it to the deletion
            // list.
            existingChildren.delete(
              newFiber.key === null ? newIdx : newFiber.key,
            );
          }
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
    }

    if (shouldTrackSideEffects) {
      // Any existing children that weren't consumed above were deleted. We need
      // to add them to the deletion list.
      existingChildren.forEach((child) => deleteChild(returnFiber, child));
    }

    return resultingFirstChild;
  }

  // 协调单个文本fiber
  // 根据老的currentFirstChild决定是否复用，生成子workInProgress
  // 新创建的子workInProgress没有对应的currentFiber
  function reconcileSingleTextNode(
    returnFiber: Fiber, // 父workInProgress
    currentFirstChild: Fiber | null, // 父currentFiber的第一个子fiber
    textContent: string, // 文本
    lanes: Lanes,
  ): Fiber {
    // There's no need to check for keys on text nodes since we don't have a
    // way to define them.
    // 文本fiber没有key
    if (currentFirstChild !== null && currentFirstChild.tag === HostText) {
      // We already have an existing node so let's just update it and delete
      // the rest.
      // currentFirstChild是文本fiber
      // currentFirstChild之后的所有兄弟节点标记删除，也就是只保留currentFirstChild
      deleteRemainingChildren(returnFiber, currentFirstChild.sibling);
      // 复用currentFirstChild对应的workInProgress，return指向父workInProgress
      const existing = useFiber(currentFirstChild, textContent);
      existing.return = returnFiber;
      return existing;
    }
    // The existing first child is not a text node so we need to create one
    // and delete the existing ones.
    // currentFirstChild不是文本fiber
    // currentFirstChild 及其 之后的所有兄弟节点标记删除，也就是所有的都标记删除
    deleteRemainingChildren(returnFiber, currentFirstChild);
    // 创建一个新的文本workInProgress，return指向父workInProgress
    const created = createFiberFromText(textContent, returnFiber.mode, lanes);
    created.return = returnFiber;
    return created;
  }

  // 单element节点diff
  // 遍历returnFiber的所有子fiber，如果找到可复用的子fiber，就根据element更新子fiber对应的workInProgress并返回
  // 这里会把已经遍历过的所有子fiber都标记删除
  // 如果没有找到，就所有子fiber标记移除，根据element生成新的workInProgress(只有return指向父workInProgress，没有child和sibling)并返回
  function reconcileSingleElement(
    returnFiber: Fiber, // 父workInProgress
    currentFirstChild: Fiber | null, // 父currentFiber的第一个子fiber
    element: ReactElement, // 新的reactElement
    lanes: Lanes,
  ): Fiber {
    const key = element.key;
    let child = currentFirstChild;
    // 循环遍历所有子fiber
    // 如果找到可复用的并返回了复用的workInProgress，那么同级的其他所有 兄弟fiber 都会被标记删除
    // 如果没有找到，那么就将同级的所有 fiber 都标记删除
    while (child !== null) {
      // TODO: If key === null and child.key === null, then this only applies to
      // the first item in the list.
      // 新老key都为null只可能出现在list的第一项???

      if (child.key === key) {
        // 新老key相同，复用更新child fiber对应的workInProgress并返回
        switch (child.tag) {
          case Fragment: {
            // fragment
            if (element.type === REACT_FRAGMENT_TYPE) {
              // child的兄弟节点标记删除, fragment只能作为根节点
              // fragment类型fiber的sibling无用
              deleteRemainingChildren(returnFiber, child.sibling);
              // 更新child fiber对应的workInProgress
              const existing = useFiber(child, element.props.children);
              existing.return = returnFiber;
              if (__DEV__) {
                existing._debugSource = element._source;
                existing._debugOwner = element._owner;
              }
              return existing;
            }
            break;
          }
          case Block:
            if (enableBlocksAPI) {
              let type = element.type;
              if (type.$$typeof === REACT_LAZY_TYPE) {
                // 懒加载组件
                // type = type._init(type._payload)
                type = resolveLazyType(type);
              }
              if (type.$$typeof === REACT_BLOCK_TYPE) {
                // The new Block might not be initialized yet. We need to initialize
                // it in case initializing it turns out it would match.
                // 阻塞组件
                if (
                  ((type: any): BlockComponent<any, any>)._render ===
                  (child.type: BlockComponent<any, any>)._render
                ) {
                  // child的所有兄弟fiber标记删除
                  deleteRemainingChildren(returnFiber, child.sibling);
                  // 更新child fiber对应的workInProgress
                  const existing = useFiber(child, element.props);
                  existing.type = type;
                  existing.return = returnFiber;
                  if (__DEV__) {
                    existing._debugSource = element._source;
                    existing._debugOwner = element._owner;
                  }
                  return existing;
                }
              }
            }
          // We intentionally fallthrough here if enableBlocksAPI is not on.
          // eslint-disable-next-lined no-fallthrough
          // 在默认情况下都会将child视为元素，这也是单一diff的核心逻辑代码
          default: {
            if (
              child.elementType === element.type ||
              // Keep this check inline so it only runs on the false path:
              (__DEV__
                ? isCompatibleFamilyForHotReloading(child, element)
                : false)
            ) {
              // child的所有兄弟fiber标记删除
              deleteRemainingChildren(returnFiber, child.sibling);
              // 更新child对应的workInProgress
              const existing = useFiber(child, element.props);
              existing.ref = coerceRef(returnFiber, child, element);
              existing.return = returnFiber;
              if (__DEV__) {
                existing._debugSource = element._source;
                existing._debugOwner = element._owner;
              }
              return existing;
            }
            break;
          }
        }
        // Didn't match.
        // 新老key相同，但type不同，无法复用，而且不会再出现新老key相同的情况了
        // 直接将老的child及其接下来的sibling都标记删除
        deleteRemainingChildren(returnFiber, child);
        break;
      } else {
        // 新老key不同，无法复用，但是child的后续兄弟节点可能出现可以复用的情况
        // 所以这里只将老的child标记删除，没有处理child的兄弟fiber
        deleteChild(returnFiber, child);
      }
      child = child.sibling;
    }

    // 到了这一步，实际上就确定diff出结果，确实存在不同且已经把所有老的同级fiber标记删除了
    // 我们根据元素类型的不同创建不同的workInProgress
    // 新的workInProgress只有return指向returnFiber，没有child和sibling
    if (element.type === REACT_FRAGMENT_TYPE) {
      // fragment类型
      // 创建tag为fragment(7)的fiber对象
      const created = createFiberFromFragment(
        element.props.children,
        returnFiber.mode,
        lanes,
        element.key,
      );
      created.return = returnFiber;
      return created;
    } else {
      // 大部分情况都为元素
      const created = createFiberFromElement(element, returnFiber.mode, lanes);
      created.ref = coerceRef(returnFiber, currentFirstChild, element);
      created.return = returnFiber;
      return created;
    }
  }

  // 单portal节点diff
  // 逻辑和reconcileSingleElement一样
  // 复用或者创建新的workInProgress(新的只有return指向父workInProgress，没有child和sibling)
  function reconcileSinglePortal(
    returnFiber: Fiber, // 父workInProgress
    currentFirstChild: Fiber | null, // 父currentFiber的第一个子fiber
    portal: ReactPortal, // 新的reactPortal
    lanes: Lanes,
  ): Fiber {
    const key = portal.key;
    let child = currentFirstChild;
    // 遍历children的逻辑和reconcileSingleElement一样
    // 同级所有不可复用的fiber标记删除，没有可复用的就全部标记删除
    while (child !== null) {
      // TODO: If key === null and child.key === null, then this only applies to
      // the first item in the list.
      if (child.key === key) {
        if (
          child.tag === HostPortal &&
          child.stateNode.containerInfo === portal.containerInfo &&
          child.stateNode.implementation === portal.implementation
        ) {
          deleteRemainingChildren(returnFiber, child.sibling);
          const existing = useFiber(child, portal.children || []);
          existing.return = returnFiber;
          return existing;
        } else {
          deleteRemainingChildren(returnFiber, child);
          break;
        }
      } else {
        deleteChild(returnFiber, child);
      }
      child = child.sibling;
    }

    const created = createFiberFromPortal(portal, returnFiber.mode, lanes);
    created.return = returnFiber;
    return created;
  }

  // This API will tag the children with the side-effect of the reconciliation
  // itself. They will be added to the side-effect list as we pass through the
  // children and the parent.
  // diff算法的入口函数
  // 根据父workInProgress和父currentFiber对应的第一个子fiber决定复用或新创建
  // 返回第一个子workInProgress
  // 这里会对newChild(如果是数组)中的每一项生成(新创建或复用)newFiber，并设置每一个newFiber的child sibling return
  function reconcileChildFibers(
    returnFiber: Fiber, // 父workInProgress
    currentFirstChild: Fiber | null, // 父currentFiber对应的第一个子fiber
    newChild: any, // nextChildren  懒加载init(payload)
    lanes: Lanes,
  ): Fiber | null {
    // This function is not recursive.
    // If the top level item is an array, we treat it as a set of children,
    // not as a fragment. Nested arrays on the other hand will be treated as
    // fragment nodes. Recursion happens at the normal flow.
    // reconcileChildFibers并非是一个递归函数
    // 如果其第一层所传入的newChild参数是一个数组，我们之间将其视为一组子fiber而非fragment
    // 但是如果是内嵌数组，则视为fragment
    // 在一般情况下会出现递归

    // Handle top level unkeyed fragments as if they were arrays.
    // This leads to an ambiguity between <>{[...]}</> and <>...</>.
    // We treat the ambiguous cases above the same.
    // 检查当前newChild是否是一个fragment
    const isUnkeyedTopLevelFragment =
      typeof newChild === 'object' &&
      newChild !== null &&
      newChild.type === REACT_FRAGMENT_TYPE &&
      newChild.key === null;
    // fragment直接取props.children
    if (isUnkeyedTopLevelFragment) {
      newChild = newChild.props.children;
    }

    // Handle object types
    const isObject = typeof newChild === 'object' && newChild !== null;

    // newChild是对象，typeof [] === "object"
    if (isObject) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE:
          // 单点元素节点diff，组件的newChild(也就是组件的根节点)是对象
          return placeSingleChild(
            // 单element节点diff
            // 复用或者创建新的子workInProgress返回
            reconcileSingleElement(
              returnFiber,
              currentFirstChild,
              newChild,
              lanes,
            ),
          );
        case REACT_PORTAL_TYPE:
          // 单portal节点diff
          // 复用或者创建新的子workInProgress返回
          return placeSingleChild(
            reconcileSinglePortal(
              returnFiber,
              currentFirstChild,
              newChild,
              lanes,
            ),
          );
        case REACT_LAZY_TYPE:
          // 懒加载
          if (enableLazyElements) {
            const payload = newChild._payload;
            const init = newChild._init;
            // TODO: This function is supposed to be non-recursive.
            // 非递归函数
            return reconcileChildFibers(
              returnFiber,
              currentFirstChild,
              init(payload), // 这个不知道是啥???
              lanes,
            );
          }
      }
    }

    // newChild是string或number类型，则进行单文本节点diff
    // 文本fiber会移除所有兄弟节点，如果创建新的，会将自己也移除，然后生成子workInProgress返回
    if (typeof newChild === 'string' || typeof newChild === 'number') {
      // 给新创建的子workInProgress标志Placement
      // 复用的则不做处理
      // 返回子workInProgress
      return placeSingleChild(
        // 协调单个文本fiber，复用或替换，返回子workInProgress
        reconcileSingleTextNode(
          returnFiber,
          currentFirstChild,
          '' + newChild, // 转string
          lanes,
        ),
      );
    }

    // newChild是数组
    // 对newChild做dom diff，生成新的链表，并返回链表的第一个workInProgress
    if (isArray(newChild)) {
      return reconcileChildrenArray(
        returnFiber,
        currentFirstChild,
        newChild,
        lanes,
      );
    }

    // newChild为迭代器，逻辑和reconcileChildrenArray一摸一样，只是newChild由数组变成了迭代器
    // 对newChild做dom diff，生成新的链表，并返回链表的第一个workInProgress
    if (getIteratorFn(newChild)) {
      return reconcileChildrenIterator(
        returnFiber,
        currentFirstChild,
        newChild,
        lanes,
      );
    }

    // React child是一个对象报错，如 <div>{ object }</div>
    if (isObject) {
      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber);
      }
    }
    if (typeof newChild === 'undefined' && !isUnkeyedTopLevelFragment) {
      // If the new child is undefined, and the return fiber is a composite
      // component, throw an error. If Fiber return types are disabled,
      // we already threw above.
      switch (returnFiber.tag) {
        case ClassComponent: {
          if (__DEV__) {
            const instance = returnFiber.stateNode;
            if (instance.render._isMockFunction) {
              // We allow auto-mocks to proceed as if they're returning null.
              break;
            }
          }
        }
        // Intentionally fall through to the next case, which handles both
        // functions and classes
        // eslint-disable-next-lined no-fallthrough
        case Block:
        case FunctionComponent:
        case ForwardRef:
        case SimpleMemoComponent: {
          invariant(
            false,
            '%s(...): Nothing was returned from render. This usually means a ' +
              'return statement is missing. Or, to render nothing, ' +
              'return null.',
            getComponentName(returnFiber.type) || 'Component',
          );
        }
      }
    }

    // Remaining cases are all treated as empty.
    // 走到这里的情况，都视为当作空fiber处理
    // 将currentFirstChild的所有同级fiber都标记删除，添加到父workInProgress的update队列中
    return deleteRemainingChildren(returnFiber, currentFirstChild);
  }

  return reconcileChildFibers;
}

export const reconcileChildFibers = ChildReconciler(true); // 更新复用
export const mountChildFibers = ChildReconciler(false); // 挂载新的

// 根据workInProgress的当前child和child.pendingProps创建出新的child
export function cloneChildFibers(
  current: Fiber | null,
  workInProgress: Fiber,
): void {
  invariant(
    current === null || workInProgress.child === current.child,
    'Resuming work not yet implemented.',
  );

  // 这里的workInProgress必然是复用的
  // 如果没有child，就直接return
  if (workInProgress.child === null) {
    return;
  }

  // 创建第一个newChild，这里是复用了currentChild
  let currentChild = workInProgress.child;
  let newChild = createWorkInProgress(currentChild, currentChild.pendingProps);
  workInProgress.child = newChild;
  newChild.return = workInProgress;
  // 创建剩下的newChild，这里也是复用了对应的currentChild
  while (currentChild.sibling !== null) {
    currentChild = currentChild.sibling;
    newChild = newChild.sibling = createWorkInProgress(
      currentChild,
      currentChild.pendingProps,
    );
    newChild.return = workInProgress;
  }
  // 最后一个子fiber的sibling设为null
  newChild.sibling = null;
}

// Reset a workInProgress child set to prepare it for a second pass.
export function resetChildFibers(workInProgress: Fiber, lanes: Lanes): void {
  let child = workInProgress.child;
  while (child !== null) {
    resetWorkInProgress(child, lanes);
    child = child.sibling;
  }
}
