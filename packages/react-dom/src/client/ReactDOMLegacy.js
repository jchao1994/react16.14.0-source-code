/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Container} from './ReactDOMHostConfig';
import type {RootType} from './ReactDOMRoot';
import type {ReactNodeList} from 'shared/ReactTypes';

import {
  getInstanceFromNode,
  isContainerMarkedAsRoot,
  unmarkContainerAsRoot,
} from './ReactDOMComponentTree';
import {createLegacyRoot, isValidContainer} from './ReactDOMRoot';
import {ROOT_ATTRIBUTE_NAME} from '../shared/DOMProperty';
import {
  DOCUMENT_NODE,
  ELEMENT_NODE,
  COMMENT_NODE,
} from '../shared/HTMLNodeType';

import {
  findHostInstanceWithNoPortals,
  updateContainer,
  unbatchedUpdates,
  getPublicRootInstance,
  findHostInstance,
  findHostInstanceWithWarning,
} from 'react-reconciler/src/ReactFiberReconciler';
import getComponentName from 'shared/getComponentName';
import invariant from 'shared/invariant';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import {has as hasInstance} from 'shared/ReactInstanceMap';

const ReactCurrentOwner = ReactSharedInternals.ReactCurrentOwner;

let topLevelUpdateWarnings;
let warnedAboutHydrateAPI = false;

if (__DEV__) {
  topLevelUpdateWarnings = (container: Container) => {
    if (container._reactRootContainer && container.nodeType !== COMMENT_NODE) {
      const hostInstance = findHostInstanceWithNoPortals(
        container._reactRootContainer._internalRoot.current,
      );
      if (hostInstance) {
        if (hostInstance.parentNode !== container) {
          console.error(
            'render(...): It looks like the React-rendered content of this ' +
              'container was removed without using React. This is not ' +
              'supported and will cause errors. Instead, call ' +
              'ReactDOM.unmountComponentAtNode to empty a container.',
          );
        }
      }
    }

    const isRootRenderedBySomeReact = !!container._reactRootContainer;
    const rootEl = getReactRootElementInContainer(container);
    const hasNonRootReactChild = !!(rootEl && getInstanceFromNode(rootEl));

    if (hasNonRootReactChild && !isRootRenderedBySomeReact) {
      console.error(
        'render(...): Replacing React-rendered children with a new root ' +
          'component. If you intended to update the children of this node, ' +
          'you should instead have the existing children update their state ' +
          'and render the new components instead of calling ReactDOM.render.',
      );
    }

    if (
      container.nodeType === ELEMENT_NODE &&
      ((container: any): Element).tagName &&
      ((container: any): Element).tagName.toUpperCase() === 'BODY'
    ) {
      console.error(
        'render(): Rendering components directly into document.body is ' +
          'discouraged, since its children are often manipulated by third-party ' +
          'scripts and browser extensions. This may lead to subtle ' +
          'reconciliation issues. Try rendering into a container element created ' +
          'for your app.',
      );
    }
  };
}

// 根据container来获取DOM容器中的第一个子节点
function getReactRootElementInContainer(container: any) {
  if (!container) {
    return null;
  }

  if (container.nodeType === DOCUMENT_NODE) {
    return container.documentElement;
  } else {
    return container.firstChild;
  }
}

// 根据nodeType和attribute判断是否需要融合
// 服务端渲染结果如下，带有data-reactroot属性
// {/* <body>
//     <div id="root">
//         <div data-reactroot=""></div>
//     </div>
// </body> */}
function shouldHydrateDueToLegacyHeuristic(container) {
  const rootElement = getReactRootElementInContainer(container);
  return !!(
    rootElement &&
    rootElement.nodeType === ELEMENT_NODE && // 1
    rootElement.hasAttribute(ROOT_ATTRIBUTE_NAME) // data-reactroot
  );
}

// 创建并返回一个ReactDOMBlockingRoot实例
// 该实例具有一个_internalRoot属性指向fiberRoot，且有render和unmount方法
function legacyCreateRootFromDOMContainer(
  container: Container, // document.getElementById('root')
  forceHydrate: boolean,
): RootType {
  // 是否需要融合(SSR)
  const shouldHydrate =
    forceHydrate || shouldHydrateDueToLegacyHeuristic(container);
  // First clear any existing content.
  // 针对客户端渲染的情况，清除container上的所有节点
  if (!shouldHydrate) {
    let warned = false;
    let rootSibling;
    while ((rootSibling = container.lastChild)) {
      if (__DEV__) {
        if (
          !warned &&
          rootSibling.nodeType === ELEMENT_NODE &&
          (rootSibling: any).hasAttribute(ROOT_ATTRIBUTE_NAME)
        ) {
          warned = true;
          console.error(
            'render(): Target node has markup rendered by React, but there ' +
              'are unrelated nodes as well. This is most commonly caused by ' +
              'white-space inserted around server-rendered markup.',
          );
        }
      }
      container.removeChild(rootSibling);
    }
  }
  if (__DEV__) {
    if (shouldHydrate && !forceHydrate && !warnedAboutHydrateAPI) {
      warnedAboutHydrateAPI = true;
      console.warn(
        'render(): Calling ReactDOM.render() to hydrate server-rendered markup ' +
          'will stop working in React v18. Replace the ReactDOM.render() call ' +
          'with ReactDOM.hydrate() if you want React to attach to the server HTML.',
      );
    }
  }

  // 返回一个ReactDOMBlockingRoot实例
  // 该实例具有一个_internalRoot属性指向fiberRoot，且有render和unmount方法
  // this._internalRoot = createRootImpl(container, tag, options)
  // 如果是服务端渲染，React不删除子节点DOM的原因，在于复用已有DOM提高渲染性能
  return createLegacyRoot(
    container,
    shouldHydrate
      ? {
          hydrate: true,
        }
      : undefined,
  );
}

function warnOnInvalidCallback(callback: mixed, callerName: string): void {
  if (__DEV__) {
    if (callback !== null && typeof callback !== 'function') {
      console.error(
        '%s(...): Expected the last optional `callback` argument to be a ' +
          'function. Instead received: %s.',
        callerName,
        callback,
      );
    }
  }
}

// 内部渲染函数
function legacyRenderSubtreeIntoContainer(
  parentComponent: ?React$Component<any, any>, // 父组件，root节点这里为null，因为root节点不存在父级组件
  children: ReactNodeList, // 传入子元素，业务代码中通常为<App/>
  container: Container, // 父节点容器，业务代码中通常为document.getElementById('root')
  forceHydrate: boolean, // 是否SSR标志
  callback: ?Function, // 组件渲染完成后需要执行的回调函数，一般情况我们极少在业务代码中写回调函数
) {
  if (__DEV__) {
    topLevelUpdateWarnings(container);
    warnOnInvalidCallback(callback === undefined ? null : callback, 'render');
  }

  // TODO: Without `any` type, Flow says "Property cannot be accessed on any
  // member of intersection type." Whyyyyyy.
  // 在第一次执行的时候，container上是肯定没有_reactRootContainer属性的
  // 所以第一次执行时，root肯定为undefined
  // 从业务代码中我们得知，这就是一个id为root的真实dom对象
  let root: RootType = (container._reactRootContainer: any);
  // 定义一个fiberRoot变量，它是React fiber树的根，也是所有的虚拟DOM的集合对象
  let fiberRoot;
  if (!root) {
    // Initial mount
    // 首次渲染
    // 进入当前流程控制中，container._reactRootContainer指向一个ReactDOMBlockingRoot实例
    // 因为root不存在，我们现在要基于这个真实DOM创建root，这个对象中有一个指针属性_internalRoot
    // 上面挂载了整个fiber树，同时会给真实DOM添加一个私有属性__reactContainer$randomKey，
    // 表示它是当前React项目的容器
    root = container._reactRootContainer = legacyCreateRootFromDOMContainer(
      container,
      forceHydrate,
    );
    // root表示一个ReactSyncRoot实例，实例中有一个_internalRoot方法指向一个fiberRoot实例
    // 整个fiber树
    fiberRoot = root._internalRoot;
    // 重写callback
    // 一般情况下我们很少去传入第三个参数callback，所以可以不必关心这里的内容
    if (typeof callback === 'function') {
      const originalCallback = callback; // 用户传入的callback
      callback = function() {
        // 通过fiberRoot去找到其对应的rootFiber，然后将rootFiber的第一个child的stateNode作为callback中的this指向
        const instance = getPublicRootInstance(fiberRoot);
        originalCallback.call(instance);
      };
    }
    // Initial mount should not be batched.
    // 对于首次挂载来说，更新操作不应该是批量的，所以会先执行unbatchedUpdates方法
    // 该方法中会将executionContext(执行上下文)切换成LegacyUnbatchedContext(非批量上下文)
    // 切换上下文之后再调用updateContainer执行更新操作
    // 执行完updateContainer之后再将executionContext恢复到之前的状态
    // unbatchedUpdates修改executionContext的目的，是让react更新变成异步的
    // 初次render的时候，会修改executionContext，让react进入异步更新状态
    unbatchedUpdates(() => {
      // 更新整个react容器，整个fiberRoot的对象树会被整体构建
      updateContainer(children, fiberRoot, parentComponent, callback);
    });
  } else {
    // 更新渲染
    // container._reactRootContainer上已经存在一个ReactDOMBlockingRoot实例
    fiberRoot = root._internalRoot;
    // 重写callback，同首次渲染
    // 一般情况下我们很少去传入第三个参数callback，所以可以不必关心这里的内容
    if (typeof callback === 'function') {
      const originalCallback = callback;
      callback = function() {
        const instance = getPublicRootInstance(fiberRoot);
        originalCallback.call(instance);
      };
    }
    // Update
    // 对于非首次挂载来说，是不需要再调用unbatchedUpdates方法的
    // 即不再需要将executionContext(执行上下文)切换成LegacyUnbatchedContext(非批量上下文)
    // 而是直接调用updateContainer执行更新操作
    // 因为更新渲染一般是通过react合成事件触发，已经修改了executionContext，将react进入异步更新状态，这里不需要重复修改executionContext
    updateContainer(children, fiberRoot, parentComponent, callback);
  }
  // 返回rootFiber.child.stateNode，rootFiber.child对应的组件实例
  return getPublicRootInstance(fiberRoot);
}

export function findDOMNode(
  componentOrElement: Element | ?React$Component<any, any>,
): null | Element | Text {
  if (__DEV__) {
    const owner = (ReactCurrentOwner.current: any);
    if (owner !== null && owner.stateNode !== null) {
      const warnedAboutRefsInRender = owner.stateNode._warnedAboutRefsInRender;
      if (!warnedAboutRefsInRender) {
        console.error(
          '%s is accessing findDOMNode inside its render(). ' +
            'render() should be a pure function of props and state. It should ' +
            'never access something that requires stale data from the previous ' +
            'render, such as refs. Move this logic to componentDidMount and ' +
            'componentDidUpdate instead.',
          getComponentName(owner.type) || 'A component',
        );
      }
      owner.stateNode._warnedAboutRefsInRender = true;
    }
  }
  if (componentOrElement == null) {
    return null;
  }
  if ((componentOrElement: any).nodeType === ELEMENT_NODE) {
    return (componentOrElement: any);
  }
  if (__DEV__) {
    return findHostInstanceWithWarning(componentOrElement, 'findDOMNode');
  }
  return findHostInstance(componentOrElement);
}

// 服务端渲染SSR
export function hydrate(
  element: React$Node, // vnode
  container: Container, // 父节点容器
  callback: ?Function, // 组件渲染完成后需要执行的回调函数
) {
  invariant(
    isValidContainer(container),
    'Target container is not a DOM element.',
  );
  if (__DEV__) {
    const isModernRoot =
      isContainerMarkedAsRoot(container) &&
      container._reactRootContainer === undefined;
    if (isModernRoot) {
      console.error(
        'You are calling ReactDOM.hydrate() on a container that was previously ' +
          'passed to ReactDOM.createRoot(). This is not supported. ' +
          'Did you mean to call createRoot(container, {hydrate: true}).render(element)?',
      );
    }
  }
  // TODO: throw or warn if we couldn't hydrate?
  return legacyRenderSubtreeIntoContainer(
    null,
    element,
    container,
    true,
    callback,
  );
}

// ReactDOM.render，客户端渲染
// ReactDOM.render()只是编写在jsx文件中的函数，对于react-dom库来说它一不负责diff算法，二不负责dom绘制
// 它只负责在fiberNode和浏览器DOM之间做一个桥接，告诉react-reconciler库你该如何更新fiber树，然后把新的fiber树还我
// 在拿到新的fiber树后，它会通过babel抽取AST语法树将代码编写成React.createElement()形式，最后生成真实DOM渲染到浏览器上。
export function render(
  element: React$Element<any>, // 子元素，jsx内部通过createElement解析成的reactElement对象，通常为<App />
  container: Container, // 父节点容器，通常为document.getElementById('root')
  callback: ?Function, // 组件渲染完成后需要执行的回调函数
) {
  invariant(
    isValidContainer(container),
    'Target container is not a DOM element.',
  );
  if (__DEV__) {
    const isModernRoot =
      isContainerMarkedAsRoot(container) &&
      container._reactRootContainer === undefined;
    if (isModernRoot) {
      console.error(
        'You are calling ReactDOM.render() on a container that was previously ' +
          'passed to ReactDOM.createRoot(). This is not supported. ' +
          'Did you mean to call root.render(element)?',
      );
    }
  }
  return legacyRenderSubtreeIntoContainer(
    null,
    element,
    container,
    false,
    callback,
  );
}

export function unstable_renderSubtreeIntoContainer(
  parentComponent: React$Component<any, any>,
  element: React$Element<any>,
  containerNode: Container,
  callback: ?Function,
) {
  invariant(
    isValidContainer(containerNode),
    'Target container is not a DOM element.',
  );
  invariant(
    parentComponent != null && hasInstance(parentComponent),
    'parentComponent must be a valid React Component',
  );
  return legacyRenderSubtreeIntoContainer(
    parentComponent,
    element,
    containerNode,
    false,
    callback,
  );
}

export function unmountComponentAtNode(container: Container) {
  invariant(
    isValidContainer(container),
    'unmountComponentAtNode(...): Target container is not a DOM element.',
  );

  if (__DEV__) {
    const isModernRoot =
      isContainerMarkedAsRoot(container) &&
      container._reactRootContainer === undefined;
    if (isModernRoot) {
      console.error(
        'You are calling ReactDOM.unmountComponentAtNode() on a container that was previously ' +
          'passed to ReactDOM.createRoot(). This is not supported. Did you mean to call root.unmount()?',
      );
    }
  }

  if (container._reactRootContainer) {
    if (__DEV__) {
      const rootEl = getReactRootElementInContainer(container);
      const renderedByDifferentReact = rootEl && !getInstanceFromNode(rootEl);
      if (renderedByDifferentReact) {
        console.error(
          "unmountComponentAtNode(): The node you're attempting to unmount " +
            'was rendered by another copy of React.',
        );
      }
    }

    // Unmount should not be batched.
    unbatchedUpdates(() => {
      legacyRenderSubtreeIntoContainer(null, null, container, false, () => {
        // $FlowFixMe This should probably use `delete container._reactRootContainer`
        container._reactRootContainer = null;
        unmarkContainerAsRoot(container);
      });
    });
    // If you call unmountComponentAtNode twice in quick succession, you'll
    // get `true` twice. That's probably fine?
    return true;
  } else {
    if (__DEV__) {
      const rootEl = getReactRootElementInContainer(container);
      const hasNonRootReactChild = !!(rootEl && getInstanceFromNode(rootEl));

      // Check if the container itself is a React root node.
      const isContainerReactRoot =
        container.nodeType === ELEMENT_NODE &&
        isValidContainer(container.parentNode) &&
        !!container.parentNode._reactRootContainer;

      if (hasNonRootReactChild) {
        console.error(
          "unmountComponentAtNode(): The node you're attempting to unmount " +
            'was rendered by React and is not a top-level container. %s',
          isContainerReactRoot
            ? 'You may have accidentally passed in a React root node instead ' +
                'of its container.'
            : 'Instead, have the parent component update its state and ' +
                'rerender in order to remove this component.',
        );
      }
    }

    return false;
  }
}
