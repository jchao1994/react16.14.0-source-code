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
import type {UpdateQueue} from './ReactUpdateQueue.old';

import * as React from 'react';
import {Update, Snapshot} from './ReactFiberFlags';
import {
  debugRenderPhaseSideEffectsForStrictMode,
  disableLegacyContext,
  enableDebugTracing,
  enableSchedulingProfiler,
  warnAboutDeprecatedLifecycles,
} from 'shared/ReactFeatureFlags';
import ReactStrictModeWarnings from './ReactStrictModeWarnings.old';
import {isMounted} from './ReactFiberTreeReflection';
import {get as getInstance, set as setInstance} from 'shared/ReactInstanceMap';
import shallowEqual from 'shared/shallowEqual';
import getComponentName from 'shared/getComponentName';
import invariant from 'shared/invariant';
import {REACT_CONTEXT_TYPE, REACT_PROVIDER_TYPE} from 'shared/ReactSymbols';

import {resolveDefaultProps} from './ReactFiberLazyComponent.old';
import {DebugTracingMode, StrictMode} from './ReactTypeOfMode';

import {
  enqueueUpdate,
  processUpdateQueue,
  checkHasForceUpdateAfterProcessing,
  resetHasForceUpdateBeforeProcessing,
  createUpdate,
  ReplaceState,
  ForceUpdate,
  initializeUpdateQueue,
  cloneUpdateQueue,
} from './ReactUpdateQueue.old';
import {NoLanes} from './ReactFiberLane';
import {
  cacheContext,
  getMaskedContext,
  getUnmaskedContext,
  hasContextChanged,
  emptyContextObject,
} from './ReactFiberContext.old';
import {readContext} from './ReactFiberNewContext.old';
import {
  requestEventTime,
  requestUpdateLane,
  scheduleUpdateOnFiber,
} from './ReactFiberWorkLoop.old';
import {logForceUpdateScheduled, logStateUpdateScheduled} from './DebugTracing';

import {disableLogs, reenableLogs} from 'shared/ConsolePatchingDev';
import {
  markForceUpdateScheduled,
  markStateUpdateScheduled,
} from './SchedulingProfiler';

const fakeInternalInstance = {};
const isArray = Array.isArray;

// React.Component uses a shared frozen object by default.
// We'll use it to determine whether we need to initialize legacy refs.
export const emptyRefsObject = new React.Component().refs;

let didWarnAboutStateAssignmentForComponent;
let didWarnAboutUninitializedState;
let didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate;
let didWarnAboutLegacyLifecyclesAndDerivedState;
let didWarnAboutUndefinedDerivedState;
let warnOnUndefinedDerivedState;
let warnOnInvalidCallback;
let didWarnAboutDirectlyAssigningPropsToState;
let didWarnAboutContextTypeAndContextTypes;
let didWarnAboutInvalidateContextType;

if (__DEV__) {
  didWarnAboutStateAssignmentForComponent = new Set();
  didWarnAboutUninitializedState = new Set();
  didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate = new Set();
  didWarnAboutLegacyLifecyclesAndDerivedState = new Set();
  didWarnAboutDirectlyAssigningPropsToState = new Set();
  didWarnAboutUndefinedDerivedState = new Set();
  didWarnAboutContextTypeAndContextTypes = new Set();
  didWarnAboutInvalidateContextType = new Set();

  const didWarnOnInvalidCallback = new Set();

  warnOnInvalidCallback = function(callback: mixed, callerName: string) {
    if (callback === null || typeof callback === 'function') {
      return;
    }
    const key = callerName + '_' + (callback: any);
    if (!didWarnOnInvalidCallback.has(key)) {
      didWarnOnInvalidCallback.add(key);
      console.error(
        '%s(...): Expected the last optional `callback` argument to be a ' +
          'function. Instead received: %s.',
        callerName,
        callback,
      );
    }
  };

  warnOnUndefinedDerivedState = function(type, partialState) {
    if (partialState === undefined) {
      const componentName = getComponentName(type) || 'Component';
      if (!didWarnAboutUndefinedDerivedState.has(componentName)) {
        didWarnAboutUndefinedDerivedState.add(componentName);
        console.error(
          '%s.getDerivedStateFromProps(): A valid state object (or null) must be returned. ' +
            'You have returned undefined.',
          componentName,
        );
      }
    }
  };

  // This is so gross but it's at least non-critical and can be removed if
  // it causes problems. This is meant to give a nicer error message for
  // ReactDOM15.unstable_renderSubtreeIntoContainer(reactDOM16Component,
  // ...)) which otherwise throws a "_processChildContext is not a function"
  // exception.
  Object.defineProperty(fakeInternalInstance, '_processChildContext', {
    enumerable: false,
    value: function() {
      invariant(
        false,
        '_processChildContext is not available in React 16+. This likely ' +
          'means you have multiple copies of React and are attempting to nest ' +
          'a React 15 tree inside a React 16 tree using ' +
          "unstable_renderSubtreeIntoContainer, which isn't supported. Try " +
          'to make sure you have only one copy of React (and ideally, switch ' +
          'to ReactDOM.createPortal).',
      );
    },
  });
  Object.freeze(fakeInternalInstance);
}

// 更新workInProgress.memoizedState和workInProgress.updateQueue.baseState
export function applyDerivedStateFromProps(
  workInProgress: Fiber,
  ctor: any, // Component
  getDerivedStateFromProps: (props: any, state: any) => any,
  nextProps: any,
) {
  const prevState = workInProgress.memoizedState;

  if (__DEV__) {
    if (
      debugRenderPhaseSideEffectsForStrictMode &&
      workInProgress.mode & StrictMode
    ) {
      disableLogs();
      try {
        // Invoke the function an extra time to help detect side-effects.
        getDerivedStateFromProps(nextProps, prevState);
      } finally {
        reenableLogs();
      }
    }
  }

  const partialState = getDerivedStateFromProps(nextProps, prevState);

  if (__DEV__) {
    warnOnUndefinedDerivedState(ctor, partialState);
  }
  // Merge the partial state and the previous state.
  const memoizedState =
    partialState === null || partialState === undefined
      ? prevState
      : Object.assign({}, prevState, partialState);
  workInProgress.memoizedState = memoizedState;

  // Once the update queue is empty, persist the derived state onto the
  // base state.
  if (workInProgress.lanes === NoLanes) {
    // Queue is always non-null for classes
    const updateQueue: UpdateQueue<any> = (workInProgress.updateQueue: any);
    updateQueue.baseState = memoizedState;
  }
}

const classComponentUpdater = {
  isMounted,
  // setState
  // setState和render中的updateContainer的更新原理一致
  // 根据需要更新的数据和callback生成一个update，放入对应的workInProgress.updateQueue.shared.pending中
  // 然后进行调度，执行performSyncWorkOnRoot，先render diff后提交，完成页面更新
  enqueueSetState(inst, payload, callback) { // inst是this.setState的this，也就是classComponent实例
    // 获取当前更新的workInProgress
    const fiber = getInstance(inst);
    //获取eventTime（程序运行到此刻的时间戳），React会基于它进行更新优先级排序
    const eventTime = requestEventTime();
    // React16.8中引入的泳道概念，替代了ExpirationTime标注更新task的优先级
    const lane = requestUpdateLane(fiber);

    // 将上面的计算出来的值合并成一个update对象
    const update = createUpdate(eventTime, lane);
    // payload是setState传进来的要更新的对象
    update.payload = payload;
    // callback是更新完成后的回调函数
    if (callback !== undefined && callback !== null) {
      if (__DEV__) {
        warnOnInvalidCallback(callback, 'setState');
      }
      update.callback = callback;
    }

    // 将update对象放在fiber的更新队列updateQueue.shared.pending上，用于之后更新
    // 从名称上看是队列更新，实际上是对fiber中的链表进行更新，将update task对象挂载到pending属性上
    enqueueUpdate(fiber, update);
    // 开始react异步渲染的核心，任务调度更新  React Scheduler
    // 内部核心逻辑都是performSyncWorkOnRoot
    // performSyncWorkOnRoot 先执行同步工作renderRootSync，然后提交root
    scheduleUpdateOnFiber(fiber, lane, eventTime);

    if (__DEV__) {
      if (enableDebugTracing) {
        if (fiber.mode & DebugTracingMode) {
          const name = getComponentName(fiber.type) || 'Unknown';
          logStateUpdateScheduled(name, lane, payload);
        }
      }
    }

    if (enableSchedulingProfiler) {
      markStateUpdateScheduled(fiber, lane);
    }
  },
  enqueueReplaceState(inst, payload, callback) {
    const fiber = getInstance(inst);
    const eventTime = requestEventTime();
    const lane = requestUpdateLane(fiber);

    const update = createUpdate(eventTime, lane);
    update.tag = ReplaceState;
    update.payload = payload;

    if (callback !== undefined && callback !== null) {
      if (__DEV__) {
        warnOnInvalidCallback(callback, 'replaceState');
      }
      update.callback = callback;
    }

    enqueueUpdate(fiber, update);
    scheduleUpdateOnFiber(fiber, lane, eventTime);

    if (__DEV__) {
      if (enableDebugTracing) {
        if (fiber.mode & DebugTracingMode) {
          const name = getComponentName(fiber.type) || 'Unknown';
          logStateUpdateScheduled(name, lane, payload);
        }
      }
    }

    if (enableSchedulingProfiler) {
      markStateUpdateScheduled(fiber, lane);
    }
  },
  // forceUpdate和setState的区别就是设置update.tag为2，setState中的update.tag默认为0
  enqueueForceUpdate(inst, callback) {
    const fiber = getInstance(inst);
    const eventTime = requestEventTime();
    const lane = requestUpdateLane(fiber);

    const update = createUpdate(eventTime, lane);
    //与setState不同的地方
    //默认是0更新，需要改成2强制更新
    update.tag = ForceUpdate;

    if (callback !== undefined && callback !== null) {
      if (__DEV__) {
        warnOnInvalidCallback(callback, 'forceUpdate');
      }
      update.callback = callback;
    }

    enqueueUpdate(fiber, update);
    scheduleUpdateOnFiber(fiber, lane, eventTime);

    if (__DEV__) {
      if (enableDebugTracing) {
        if (fiber.mode & DebugTracingMode) {
          const name = getComponentName(fiber.type) || 'Unknown';
          logForceUpdateScheduled(name, lane);
        }
      }
    }

    if (enableSchedulingProfiler) {
      markForceUpdateScheduled(fiber, lane);
    }
  },
};

// 根据shouldComponentUpdate生命周期，或者PureReactComponent
// 对新老props和新老state做对比，返回shouldUpdate
// 如果两个都没有，默认返回true
function checkShouldComponentUpdate(
  workInProgress,
  ctor, // Component
  oldProps,
  newProps,
  oldState,
  newState,
  nextContext,
) {
  const instance = workInProgress.stateNode;
  if (typeof instance.shouldComponentUpdate === 'function') {
    if (__DEV__) {
      if (
        debugRenderPhaseSideEffectsForStrictMode &&
        workInProgress.mode & StrictMode
      ) {
        disableLogs();
        try {
          // Invoke the function an extra time to help detect side-effects.
          instance.shouldComponentUpdate(newProps, newState, nextContext);
        } finally {
          reenableLogs();
        }
      }
    }
    const shouldUpdate = instance.shouldComponentUpdate(
      newProps,
      newState,
      nextContext,
    );

    if (__DEV__) {
      if (shouldUpdate === undefined) {
        console.error(
          '%s.shouldComponentUpdate(): Returned undefined instead of a ' +
            'boolean value. Make sure to return true or false.',
          getComponentName(ctor) || 'Component',
        );
      }
    }

    return shouldUpdate;
  }

  // PureReactComponent
  // 浅比较props和state
  if (ctor.prototype && ctor.prototype.isPureReactComponent) {
    return (
      !shallowEqual(oldProps, newProps) || !shallowEqual(oldState, newState)
    );
  }

  return true;
}

function checkClassInstance(workInProgress: Fiber, ctor: any, newProps: any) {
  const instance = workInProgress.stateNode;
  if (__DEV__) {
    const name = getComponentName(ctor) || 'Component';
    const renderPresent = instance.render;

    if (!renderPresent) {
      if (ctor.prototype && typeof ctor.prototype.render === 'function') {
        console.error(
          '%s(...): No `render` method found on the returned component ' +
            'instance: did you accidentally return an object from the constructor?',
          name,
        );
      } else {
        console.error(
          '%s(...): No `render` method found on the returned component ' +
            'instance: you may have forgotten to define `render`.',
          name,
        );
      }
    }

    if (
      instance.getInitialState &&
      !instance.getInitialState.isReactClassApproved &&
      !instance.state
    ) {
      console.error(
        'getInitialState was defined on %s, a plain JavaScript class. ' +
          'This is only supported for classes created using React.createClass. ' +
          'Did you mean to define a state property instead?',
        name,
      );
    }
    if (
      instance.getDefaultProps &&
      !instance.getDefaultProps.isReactClassApproved
    ) {
      console.error(
        'getDefaultProps was defined on %s, a plain JavaScript class. ' +
          'This is only supported for classes created using React.createClass. ' +
          'Use a static property to define defaultProps instead.',
        name,
      );
    }
    if (instance.propTypes) {
      console.error(
        'propTypes was defined as an instance property on %s. Use a static ' +
          'property to define propTypes instead.',
        name,
      );
    }
    if (instance.contextType) {
      console.error(
        'contextType was defined as an instance property on %s. Use a static ' +
          'property to define contextType instead.',
        name,
      );
    }

    if (disableLegacyContext) {
      if (ctor.childContextTypes) {
        console.error(
          '%s uses the legacy childContextTypes API which is no longer supported. ' +
            'Use React.createContext() instead.',
          name,
        );
      }
      if (ctor.contextTypes) {
        console.error(
          '%s uses the legacy contextTypes API which is no longer supported. ' +
            'Use React.createContext() with static contextType instead.',
          name,
        );
      }
    } else {
      if (instance.contextTypes) {
        console.error(
          'contextTypes was defined as an instance property on %s. Use a static ' +
            'property to define contextTypes instead.',
          name,
        );
      }

      if (
        ctor.contextType &&
        ctor.contextTypes &&
        !didWarnAboutContextTypeAndContextTypes.has(ctor)
      ) {
        didWarnAboutContextTypeAndContextTypes.add(ctor);
        console.error(
          '%s declares both contextTypes and contextType static properties. ' +
            'The legacy contextTypes property will be ignored.',
          name,
        );
      }
    }

    if (typeof instance.componentShouldUpdate === 'function') {
      console.error(
        '%s has a method called ' +
          'componentShouldUpdate(). Did you mean shouldComponentUpdate()? ' +
          'The name is phrased as a question because the function is ' +
          'expected to return a value.',
        name,
      );
    }
    if (
      ctor.prototype &&
      ctor.prototype.isPureReactComponent &&
      typeof instance.shouldComponentUpdate !== 'undefined'
    ) {
      console.error(
        '%s has a method called shouldComponentUpdate(). ' +
          'shouldComponentUpdate should not be used when extending React.PureComponent. ' +
          'Please extend React.Component if shouldComponentUpdate is used.',
        getComponentName(ctor) || 'A pure component',
      );
    }
    if (typeof instance.componentDidUnmount === 'function') {
      console.error(
        '%s has a method called ' +
          'componentDidUnmount(). But there is no such lifecycle method. ' +
          'Did you mean componentWillUnmount()?',
        name,
      );
    }
    if (typeof instance.componentDidReceiveProps === 'function') {
      console.error(
        '%s has a method called ' +
          'componentDidReceiveProps(). But there is no such lifecycle method. ' +
          'If you meant to update the state in response to changing props, ' +
          'use componentWillReceiveProps(). If you meant to fetch data or ' +
          'run side-effects or mutations after React has updated the UI, use componentDidUpdate().',
        name,
      );
    }
    if (typeof instance.componentWillRecieveProps === 'function') {
      console.error(
        '%s has a method called ' +
          'componentWillRecieveProps(). Did you mean componentWillReceiveProps()?',
        name,
      );
    }
    if (typeof instance.UNSAFE_componentWillRecieveProps === 'function') {
      console.error(
        '%s has a method called ' +
          'UNSAFE_componentWillRecieveProps(). Did you mean UNSAFE_componentWillReceiveProps()?',
        name,
      );
    }
    const hasMutatedProps = instance.props !== newProps;
    if (instance.props !== undefined && hasMutatedProps) {
      console.error(
        '%s(...): When calling super() in `%s`, make sure to pass ' +
          "up the same props that your component's constructor was passed.",
        name,
        name,
      );
    }
    if (instance.defaultProps) {
      console.error(
        'Setting defaultProps as an instance property on %s is not supported and will be ignored.' +
          ' Instead, define defaultProps as a static property on %s.',
        name,
        name,
      );
    }

    if (
      typeof instance.getSnapshotBeforeUpdate === 'function' &&
      typeof instance.componentDidUpdate !== 'function' &&
      !didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate.has(ctor)
    ) {
      didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate.add(ctor);
      console.error(
        '%s: getSnapshotBeforeUpdate() should be used with componentDidUpdate(). ' +
          'This component defines getSnapshotBeforeUpdate() only.',
        getComponentName(ctor),
      );
    }

    if (typeof instance.getDerivedStateFromProps === 'function') {
      console.error(
        '%s: getDerivedStateFromProps() is defined as an instance method ' +
          'and will be ignored. Instead, declare it as a static method.',
        name,
      );
    }
    if (typeof instance.getDerivedStateFromError === 'function') {
      console.error(
        '%s: getDerivedStateFromError() is defined as an instance method ' +
          'and will be ignored. Instead, declare it as a static method.',
        name,
      );
    }
    if (typeof ctor.getSnapshotBeforeUpdate === 'function') {
      console.error(
        '%s: getSnapshotBeforeUpdate() is defined as a static method ' +
          'and will be ignored. Instead, declare it as an instance method.',
        name,
      );
    }
    const state = instance.state;
    if (state && (typeof state !== 'object' || isArray(state))) {
      console.error('%s.state: must be set to an object or null', name);
    }
    if (
      typeof instance.getChildContext === 'function' &&
      typeof ctor.childContextTypes !== 'object'
    ) {
      console.error(
        '%s.getChildContext(): childContextTypes must be defined in order to ' +
          'use getChildContext().',
        name,
      );
    }
  }
}

// 给组件实例挂上setState replaceState forceUpdate方法，然后和workInProgress互相指引
// workInProgress的stateNode指向组件实例
// 组件实例的_reactInternals指向workInProgress
function adoptClassInstance(workInProgress: Fiber, instance: any): void {
  // 给组件实例挂上setState replaceState forceUpdate方法
  instance.updater = classComponentUpdater;
  workInProgress.stateNode = instance; // stateNode指向组件实例
  // The instance needs access to the fiber so that it can schedule updates
  // instance._reactInternals指向workInProgress
  setInstance(instance, workInProgress);
  if (__DEV__) {
    instance._reactInternalInstance = fakeInternalInstance;
  }
}

// 创建新的组件实例，更新workInProgress.memoizedState
// 给组件实例挂上setState replaceState forceUpdate方法，然后和workInProgress互相指引
function constructClassInstance(
  workInProgress: Fiber,
  ctor: any, // Component
  props: any, // nextProps
): any {
  let isLegacyContextConsumer = false;
  let unmaskedContext = emptyContextObject;
  let context = emptyContextObject;
  // contextType指向最新的context，由React.createContext()创建，用于传递数据
  const contextType = ctor.contextType;

  if (__DEV__) {
    if ('contextType' in ctor) {
      const isValid =
        // Allow null for conditional declaration
        contextType === null ||
        (contextType !== undefined &&
          contextType.$$typeof === REACT_CONTEXT_TYPE &&
          contextType._context === undefined); // Not a <Context.Consumer>

      if (!isValid && !didWarnAboutInvalidateContextType.has(ctor)) {
        didWarnAboutInvalidateContextType.add(ctor);

        let addendum = '';
        if (contextType === undefined) {
          addendum =
            ' However, it is set to undefined. ' +
            'This can be caused by a typo or by mixing up named and default imports. ' +
            'This can also happen due to a circular dependency, so ' +
            'try moving the createContext() call to a separate file.';
        } else if (typeof contextType !== 'object') {
          addendum = ' However, it is set to a ' + typeof contextType + '.';
        } else if (contextType.$$typeof === REACT_PROVIDER_TYPE) {
          addendum = ' Did you accidentally pass the Context.Provider instead?';
        } else if (contextType._context !== undefined) {
          // <Context.Consumer>
          addendum = ' Did you accidentally pass the Context.Consumer instead?';
        } else {
          addendum =
            ' However, it is set to an object with keys {' +
            Object.keys(contextType).join(', ') +
            '}.';
        }
        console.error(
          '%s defines an invalid contextType. ' +
            'contextType should point to the Context object returned by React.createContext().%s',
          getComponentName(ctor) || 'Component',
          addendum,
        );
      }
    }
  }

  // 设置context
  if (typeof contextType === 'object' && contextType !== null) {
    context = readContext((contextType: any));
  } else if (!disableLegacyContext) {
    unmaskedContext = getUnmaskedContext(workInProgress, ctor, true);
    const contextTypes = ctor.contextTypes;
    isLegacyContextConsumer =
      contextTypes !== null && contextTypes !== undefined;
    context = isLegacyContextConsumer
      ? getMaskedContext(workInProgress, unmaskedContext)
      : emptyContextObject;
  }

  // Instantiate twice to help detect side-effects.
  if (__DEV__) {
    if (
      debugRenderPhaseSideEffectsForStrictMode &&
      workInProgress.mode & StrictMode
    ) {
      disableLogs();
      try {
        new ctor(props, context); // eslint-disable-line no-new
      } finally {
        reenableLogs();
      }
    }
  }

  // 创建instance，传入props和context
  const instance = new ctor(props, context);
  // 新的state，设置到workInProgress.memoizedState上
  const state = (workInProgress.memoizedState =
    instance.state !== null && instance.state !== undefined
      ? instance.state
      : null);
  // 给组件实例挂上setState replaceState forceUpdate方法，然后和workInProgress互相指引
  adoptClassInstance(workInProgress, instance);

  if (__DEV__) {
    if (typeof ctor.getDerivedStateFromProps === 'function' && state === null) {
      const componentName = getComponentName(ctor) || 'Component';
      if (!didWarnAboutUninitializedState.has(componentName)) {
        didWarnAboutUninitializedState.add(componentName);
        console.error(
          '`%s` uses `getDerivedStateFromProps` but its initial state is ' +
            '%s. This is not recommended. Instead, define the initial state by ' +
            'assigning an object to `this.state` in the constructor of `%s`. ' +
            'This ensures that `getDerivedStateFromProps` arguments have a consistent shape.',
          componentName,
          instance.state === null ? 'null' : 'undefined',
          componentName,
        );
      }
    }

    // If new component APIs are defined, "unsafe" lifecycles won't be called.
    // Warn about these lifecycles if they are present.
    // Don't warn about react-lifecycles-compat polyfilled methods though.
    if (
      typeof ctor.getDerivedStateFromProps === 'function' ||
      typeof instance.getSnapshotBeforeUpdate === 'function'
    ) {
      let foundWillMountName = null;
      let foundWillReceivePropsName = null;
      let foundWillUpdateName = null;
      if (
        typeof instance.componentWillMount === 'function' &&
        instance.componentWillMount.__suppressDeprecationWarning !== true
      ) {
        foundWillMountName = 'componentWillMount';
      } else if (typeof instance.UNSAFE_componentWillMount === 'function') {
        foundWillMountName = 'UNSAFE_componentWillMount';
      }
      if (
        typeof instance.componentWillReceiveProps === 'function' &&
        instance.componentWillReceiveProps.__suppressDeprecationWarning !== true
      ) {
        foundWillReceivePropsName = 'componentWillReceiveProps';
      } else if (
        typeof instance.UNSAFE_componentWillReceiveProps === 'function'
      ) {
        foundWillReceivePropsName = 'UNSAFE_componentWillReceiveProps';
      }
      if (
        typeof instance.componentWillUpdate === 'function' &&
        instance.componentWillUpdate.__suppressDeprecationWarning !== true
      ) {
        foundWillUpdateName = 'componentWillUpdate';
      } else if (typeof instance.UNSAFE_componentWillUpdate === 'function') {
        foundWillUpdateName = 'UNSAFE_componentWillUpdate';
      }
      if (
        foundWillMountName !== null ||
        foundWillReceivePropsName !== null ||
        foundWillUpdateName !== null
      ) {
        const componentName = getComponentName(ctor) || 'Component';
        const newApiName =
          typeof ctor.getDerivedStateFromProps === 'function'
            ? 'getDerivedStateFromProps()'
            : 'getSnapshotBeforeUpdate()';
        if (!didWarnAboutLegacyLifecyclesAndDerivedState.has(componentName)) {
          didWarnAboutLegacyLifecyclesAndDerivedState.add(componentName);
          console.error(
            'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
              '%s uses %s but also contains the following legacy lifecycles:%s%s%s\n\n' +
              'The above lifecycles should be removed. Learn more about this warning here:\n' +
              'https://reactjs.org/link/unsafe-component-lifecycles',
            componentName,
            newApiName,
            foundWillMountName !== null ? `\n  ${foundWillMountName}` : '',
            foundWillReceivePropsName !== null
              ? `\n  ${foundWillReceivePropsName}`
              : '',
            foundWillUpdateName !== null ? `\n  ${foundWillUpdateName}` : '',
          );
        }
      }
    }
  }

  // Cache unmasked context so we can avoid recreating masked context unless necessary.
  // ReactFiberContext usually updates this cache but can't for newly-created instances.
  // 缓存unmaskedContext和context
  if (isLegacyContextConsumer) {
    cacheContext(workInProgress, unmaskedContext, context);
  }

  return instance;
}

// 执行componentWillMount和UNSAFE_componentWillMount并替换instance.state至最新值
function callComponentWillMount(workInProgress, instance) {
  const oldState = instance.state;

  if (typeof instance.componentWillMount === 'function') {
    instance.componentWillMount();
  }
  if (typeof instance.UNSAFE_componentWillMount === 'function') {
    instance.UNSAFE_componentWillMount();
  }

  if (oldState !== instance.state) {
    if (__DEV__) {
      console.error(
        '%s.componentWillMount(): Assigning directly to this.state is ' +
          "deprecated (except inside a component's " +
          'constructor). Use setState instead.',
        getComponentName(workInProgress.type) || 'Component',
      );
    }
    classComponentUpdater.enqueueReplaceState(instance, instance.state, null);
  }
}

// 调用componentWillReceiveProps和UNSAFE_componentWillReceiveProps生命周期
// 更新instance.state
function callComponentWillReceiveProps(
  workInProgress,
  instance,
  newProps,
  nextContext,
) {
  const oldState = instance.state;
  if (typeof instance.componentWillReceiveProps === 'function') {
    instance.componentWillReceiveProps(newProps, nextContext);
  }
  if (typeof instance.UNSAFE_componentWillReceiveProps === 'function') {
    instance.UNSAFE_componentWillReceiveProps(newProps, nextContext);
  }

  if (instance.state !== oldState) {
    if (__DEV__) {
      const componentName =
        getComponentName(workInProgress.type) || 'Component';
      if (!didWarnAboutStateAssignmentForComponent.has(componentName)) {
        didWarnAboutStateAssignmentForComponent.add(componentName);
        console.error(
          '%s.componentWillReceiveProps(): Assigning directly to ' +
            "this.state is deprecated (except inside a component's " +
            'constructor). Use setState instead.',
          componentName,
        );
      }
    }
    classComponentUpdater.enqueueReplaceState(instance, instance.state, null);
  }
}

// Invokes the mount life-cycles on a previously never rendered instance.
// 对从未render过的组件实例调用getDerivedStateFromProps UNSAFE_componentWillMount componentWillMount生命周期，更新instance.state
// UNSAFE_componentWillMount componentWillMount这两个过时的生命周期只有在不使用getDerivedStateFromProps和getSnapshotBeforeUpdate时候才会调用
// componentDidMount这里不调用，只给workInProgress标记update副作用，在commit阶段会调用componentDidMount
function mountClassInstance(
  workInProgress: Fiber,
  ctor: any, // Component
  newProps: any,
  renderLanes: Lanes,
): void {
  if (__DEV__) {
    checkClassInstance(workInProgress, ctor, newProps);
  }

  const instance = workInProgress.stateNode;
  instance.props = newProps;
  instance.state = workInProgress.memoizedState;
  instance.refs = emptyRefsObject;

  // 初始化workInProgress的updateQueue，baseState指向workInProgress.memoizedState
  initializeUpdateQueue(workInProgress);

  // 根据contextType设置instance.context
  const contextType = ctor.contextType;
  if (typeof contextType === 'object' && contextType !== null) {
    instance.context = readContext(contextType);
  } else if (disableLegacyContext) {
    instance.context = emptyContextObject;
  } else {
    const unmaskedContext = getUnmaskedContext(workInProgress, ctor, true);
    instance.context = getMaskedContext(workInProgress, unmaskedContext);
  }

  if (__DEV__) {
    if (instance.state === newProps) {
      const componentName = getComponentName(ctor) || 'Component';
      if (!didWarnAboutDirectlyAssigningPropsToState.has(componentName)) {
        didWarnAboutDirectlyAssigningPropsToState.add(componentName);
        console.error(
          '%s: It is not recommended to assign props directly to state ' +
            "because updates to props won't be reflected in state. " +
            'In most cases, it is better to use props directly.',
          componentName,
        );
      }
    }

    if (workInProgress.mode & StrictMode) {
      ReactStrictModeWarnings.recordLegacyContextWarning(
        workInProgress,
        instance,
      );
    }

    if (warnAboutDeprecatedLifecycles) {
      ReactStrictModeWarnings.recordUnsafeLifecycleWarnings(
        workInProgress,
        instance,
      );
    }
  }

  // 更新workInProgress.updateQueue的baseState firstBaseUpdate lastBaseUpdate
  // 标记更新lanes跳过newLanes，更新workInProgress的lanes和memoizedState
  processUpdateQueue(workInProgress, newProps, instance, renderLanes);
  // 更新instance.state
  instance.state = workInProgress.memoizedState;

  // 用户传入的getDerivedStateFromProps(props, state)生命周期
  // 在调用 render 方法之前调用，并且在初始挂载及后续更新时都会被调用
  // 它应返回一个对象来更新 state，如果返回 null 则不更新任何内容
  // 不推荐用这个生命周期，有其他代替方案
  // 这里就是初始挂载
  const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
  // 更新workInProgress.memoizedState和workInProgress.updateQueue.baseState
  // 更新instance.state
  if (typeof getDerivedStateFromProps === 'function') {
    applyDerivedStateFromProps(
      workInProgress,
      ctor,
      getDerivedStateFromProps,
      newProps,
    );
    instance.state = workInProgress.memoizedState;
  }

  // In order to support react-lifecycles-compat polyfilled components,
  // Unsafe lifecycles should not be invoked for components using the new APIs.
  // 当使用了getDerivedStateFromProps和getSnapshotBeforeUpdate生命周期
  // 就不会调用UNSAFE_componentWillMount和componentWillMount这两个过时的生命周期
  // 这两个生命周期会更新state
  if (
    typeof ctor.getDerivedStateFromProps !== 'function' &&
    typeof instance.getSnapshotBeforeUpdate !== 'function' &&
    (typeof instance.UNSAFE_componentWillMount === 'function' ||
      typeof instance.componentWillMount === 'function')
  ) {
    // 执行componentWillMount和UNSAFE_componentWillMount并替换instance.state至最新值
    callComponentWillMount(workInProgress, instance);
    // If we had additional state updates during this life-cycle, let's
    // process them now.
    // 更新workInProgress.updateQueue的baseState firstBaseUpdate lastBaseUpdate
    // 标记更新lanes跳过newLanes，更新workInProgress的lanes和memoizedState
    processUpdateQueue(workInProgress, newProps, instance, renderLanes);
    // 更新instance.state
    instance.state = workInProgress.memoizedState;
  }

  // 如果传入componentDidMount生命周期，给workInProgress加上update副作用，commit阶段会执行
  if (typeof instance.componentDidMount === 'function') {
    workInProgress.flags |= Update;
  }
}

// 复用组件实例
// 调用getDerivedStateFromProps
// 根据hasForceUpdate shouldComponentUpdate PureReactComponent设置shouldUpdate
// shouldUpdate为true，就会调用componentWillMount和UNSAFE_componentWillMount生命周期
// 为componentDidMount加上update副作用
// 最后更新workInProgress的memoizedProps和memoizedState以及组件实例的props state context
// 返回shouldUpdate
// 这里不执行更新，只是做更新前的处理，判断是否应该update
function resumeMountClassInstance(
  workInProgress: Fiber,
  ctor: any, // Component
  newProps: any,
  renderLanes: Lanes,
): boolean {
  const instance = workInProgress.stateNode; // 老的组件实例

  const oldProps = workInProgress.memoizedProps;
  instance.props = oldProps;

  const oldContext = instance.context;
  const contextType = ctor.contextType;
  let nextContext = emptyContextObject;
  // 根据contextType获取新的上下文nextContext
  if (typeof contextType === 'object' && contextType !== null) {
    nextContext = readContext(contextType);
  } else if (!disableLegacyContext) {
    const nextLegacyUnmaskedContext = getUnmaskedContext(
      workInProgress,
      ctor,
      true,
    );
    nextContext = getMaskedContext(workInProgress, nextLegacyUnmaskedContext);
  }

  // 用户传入的getDerivedStateFromProps(props, state)生命周期
  // 在调用 render 方法之前调用，并且在初始挂载及后续更新时都会被调用
  // 它应返回一个对象来更新 state，如果返回 null 则不更新任何内容
  // 不推荐用这个生命周期，有其他代替方案
  const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
  // 是否有新的生命周期getDerivedStateFromProps getSnapshotBeforeUpdate
  const hasNewLifecycles =
    typeof getDerivedStateFromProps === 'function' ||
    typeof instance.getSnapshotBeforeUpdate === 'function';

  // Note: During these life-cycles, instance.props/instance.state are what
  // ever the previously attempted to render - not the "current". However,
  // during componentDidUpdate we pass the "current" props.

  // In order to support react-lifecycles-compat polyfilled components,
  // Unsafe lifecycles should not be invoked for components using the new APIs.
  // 当使用了getDerivedStateFromProps和getSnapshotBeforeUpdate生命周期
  // 就不会调用UNSAFE_componentWillReceiveProps和componentWillReceiveProps这两个过时的生命周期
  // 这两个生命周期会更新state
  if (
    !hasNewLifecycles &&
    (typeof instance.UNSAFE_componentWillReceiveProps === 'function' ||
      typeof instance.componentWillReceiveProps === 'function')
  ) {
    if (oldProps !== newProps || oldContext !== nextContext) {
      // 只有新老props或者新老context不同时才会调用componentWillReceiveProps和UNSAFE_componentWillReceiveProps生命周期
      // 更新instance.state
      callComponentWillReceiveProps(
        workInProgress,
        instance,
        newProps,
        nextContext,
      );
    }
  }

  // hasForceUpdate重置为false
  resetHasForceUpdateBeforeProcessing();

  const oldState = workInProgress.memoizedState;
  let newState = (instance.state = oldState);
  // 更新workInProgress.updateQueue的baseState firstBaseUpdate lastBaseUpdate
  // 标记更新lanes跳过newLanes，更新workInProgress的lanes和memoizedState
  processUpdateQueue(workInProgress, newProps, instance, renderLanes);
  newState = workInProgress.memoizedState;
  // 没有变化就返回false给到shouldUpdate，表示不应该update
  // 有componentDidMount生命周期，就给workInProgress加上update副作用，在commit阶段会调用componentDidMount
  if (
    oldProps === newProps &&
    oldState === newState &&
    !hasContextChanged() &&
    !checkHasForceUpdateAfterProcessing()
  ) {
    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    if (typeof instance.componentDidMount === 'function') {
      workInProgress.flags |= Update;
    }
    return false;
  }

  // 调用getDerivedStateFromProps生命周期，更新newState
  // 这里是后续更新时
  if (typeof getDerivedStateFromProps === 'function') {
    applyDerivedStateFromProps(
      workInProgress,
      ctor,
      getDerivedStateFromProps,
      newProps,
    );
    // 更新newState
    newState = workInProgress.memoizedState;
  }

  // 根据hasForceUpdate shouldComponentUpdate PureReactComponent设置shouldUpdate
  const shouldUpdate =
    // 返回hasForceUpdate，如果强制更新，就不会做下一步判断
    checkHasForceUpdateAfterProcessing() ||
    // 根据shouldComponentUpdate生命周期，或者PureReactComponent
    // 对新老props和新老state做对比，返回shouldUpdate
    // 如果两个都没有，默认返回true
    checkShouldComponentUpdate(
      workInProgress,
      ctor,
      oldProps,
      newProps,
      oldState,
      newState,
      nextContext,
    );

  // shouldUpdate为true，就会调用componentWillMount和UNSAFE_componentWillMount生命周期
  if (shouldUpdate) {
    // 应该update，在更新之前，调用componentWillMount和UNSAFE_componentWillMount
    // 给workInProgress加上update副作用，commit阶段会调用componentDidMount

    // In order to support react-lifecycles-compat polyfilled components,
    // Unsafe lifecycles should not be invoked for components using the new APIs.
    // 调用componentWillMount和UNSAFE_componentWillMount这两个过期生命周期
    if (
      !hasNewLifecycles &&
      (typeof instance.UNSAFE_componentWillMount === 'function' ||
        typeof instance.componentWillMount === 'function')
    ) {
      if (typeof instance.componentWillMount === 'function') {
        instance.componentWillMount();
      }
      if (typeof instance.UNSAFE_componentWillMount === 'function') {
        instance.UNSAFE_componentWillMount();
      }
    }
    // 给workInProgress加上update副作用，commit阶段会调用componentDidMount
    if (typeof instance.componentDidMount === 'function') {
      workInProgress.flags |= Update;
    }
  } else {
    // 不应该update
    // 给workInProgress加上update副作用，commit阶段会调用componentDidMount
    // 更新workInProgress的memoizedProps和memoizedState

    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    // 给workInProgress加上update副作用，commit阶段会调用componentDidMount
    if (typeof instance.componentDidMount === 'function') {
      workInProgress.flags |= Update;
    }

    // If shouldComponentUpdate returned false, we should still update the
    // memoized state to indicate that this work can be reused.
    // 更新workInProgress的memoizedProps和memoizedState
    workInProgress.memoizedProps = newProps;
    workInProgress.memoizedState = newState;
  }

  // Update the existing instance's state, props, and context pointers even
  // if shouldComponentUpdate returns false.
  // 更新组件实例的props state context
  instance.props = newProps;
  instance.state = newState;
  instance.context = nextContext;

  // 返回shouldUpdate
  return shouldUpdate;
}

// Invokes the update life-cycles and returns false if it shouldn't rerender.
// 复用组件实例，逻辑与resumeMountClassInstance类似
// 调用getDerivedStateFromProps
// 根据hasForceUpdate shouldComponentUpdate PureReactComponent设置shouldUpdate
// shouldUpdate为true，就会调用componentWillUpdate和UNSAFE_componentWillUpdate生命周期
// 为componentDidUpdate和getSnapshotBeforeUpdate加上update和snapshot副作用
// 最后更新workInProgress的memoizedProps和memoizedState以及组件实例的props state context
// 返回shouldUpdate
// 这里不执行更新，只是做更新前的处理，判断是否应该update
function updateClassInstance(
  current: Fiber,
  workInProgress: Fiber,
  ctor: any, // Component
  newProps: any,
  renderLanes: Lanes,
): boolean {
  const instance = workInProgress.stateNode; // 老的组件实例

  // 将currentFiber的updateQueue克隆到workInProgress.updateQueue上
  cloneUpdateQueue(current, workInProgress);

  // 获取老的props，这里面有defaultProps
  const unresolvedOldProps = workInProgress.memoizedProps;
  const oldProps =
    workInProgress.type === workInProgress.elementType
      ? unresolvedOldProps
      : resolveDefaultProps(workInProgress.type, unresolvedOldProps);
  instance.props = oldProps;
  // 未处理的新props
  const unresolvedNewProps = workInProgress.pendingProps;

  const oldContext = instance.context;
  const contextType = ctor.contextType;
  let nextContext = emptyContextObject;
  // 根据contextType获取nextContext
  if (typeof contextType === 'object' && contextType !== null) {
    nextContext = readContext(contextType);
  } else if (!disableLegacyContext) {
    const nextUnmaskedContext = getUnmaskedContext(workInProgress, ctor, true);
    nextContext = getMaskedContext(workInProgress, nextUnmaskedContext);
  }

  // 用户传入的getDerivedStateFromProps(props, state)生命周期
  // 在调用 render 方法之前调用，并且在初始挂载及后续更新时都会被调用
  // 它应返回一个对象来更新 state，如果返回 null 则不更新任何内容
  // 不推荐用这个生命周期，有其他代替方案
  const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
  const hasNewLifecycles =
    typeof getDerivedStateFromProps === 'function' ||
    typeof instance.getSnapshotBeforeUpdate === 'function';

  // Note: During these life-cycles, instance.props/instance.state are what
  // ever the previously attempted to render - not the "current". However,
  // during componentDidUpdate we pass the "current" props.

  // In order to support react-lifecycles-compat polyfilled components,
  // Unsafe lifecycles should not be invoked for components using the new APIs.
  // 当使用了getDerivedStateFromProps和getSnapshotBeforeUpdate生命周期
  // 就不会调用UNSAFE_componentWillReceiveProps和componentWillReceiveProps这两个过时的生命周期
  // 这两个生命周期会更新state
  if (
    !hasNewLifecycles &&
    (typeof instance.UNSAFE_componentWillReceiveProps === 'function' ||
      typeof instance.componentWillReceiveProps === 'function')
  ) {
    if (
      unresolvedOldProps !== unresolvedNewProps ||
      oldContext !== nextContext
    ) {
      // 只有新老props或者新老context不同时才会调用componentWillReceiveProps和UNSAFE_componentWillReceiveProps生命周期
      // 更新instance.state
      callComponentWillReceiveProps(
        workInProgress,
        instance,
        newProps,
        nextContext,
      );
    }
  }

  // hasForceUpdate重置为false
  resetHasForceUpdateBeforeProcessing();

  const oldState = workInProgress.memoizedState;
  let newState = (instance.state = oldState);
  // 更新workInProgress.updateQueue的baseState firstBaseUpdate lastBaseUpdate
  // 标记更新lanes跳过newLanes，更新workInProgress的lanes和memoizedState
  processUpdateQueue(workInProgress, newProps, instance, renderLanes);
  newState = workInProgress.memoizedState;

  // props state context没有变化，也不是forceUpdate
  // 返回false，标记不应该update
  // 这里的比较的是workInProgress上的新老props和state
  // render是基于workInProgress的
  // 也就是说shouldUpdate是针对workInProgress的新老，而不是workInProgress和currentFiber对比???
  if (
    unresolvedOldProps === unresolvedNewProps &&
    oldState === newState &&
    !hasContextChanged() &&
    !checkHasForceUpdateAfterProcessing()
  ) {
    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    // 只有workInProgress和currentFiber上的老props和state不同，才给workInProgress加上update副作用
    // commit阶段会根据副作用调用componentDidUpdate
    if (typeof instance.componentDidUpdate === 'function') {
      if (
        unresolvedOldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.flags |= Update;
      }
    }
    // 只有workInProgress和currentFiber上的老props和state不同，才给workInProgress加上snapshot副作用
    // commit阶段会根据副作用调用getSnapshotBeforeUpdate
    if (typeof instance.getSnapshotBeforeUpdate === 'function') {
      if (
        unresolvedOldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.flags |= Snapshot;
      }
    }
    return false;
  }

  // 用户传入的getDerivedStateFromProps(props, state)生命周期
  // 在调用 render 方法之前调用，并且在初始挂载及后续更新时都会被调用
  // 它应返回一个对象来更新 state，如果返回 null 则不更新任何内容
  // 不推荐用这个生命周期，有其他代替方案
  // 这里就是后续更新
  if (typeof getDerivedStateFromProps === 'function') {
    applyDerivedStateFromProps(
      workInProgress,
      ctor,
      getDerivedStateFromProps,
      newProps,
    );
    newState = workInProgress.memoizedState;
  }

  // 根据hasForceUpdate shouldComponentUpdate PureReactComponent设置shouldUpdate
  const shouldUpdate =
    checkHasForceUpdateAfterProcessing() ||
    checkShouldComponentUpdate(
      workInProgress,
      ctor,
      oldProps,
      newProps,
      oldState,
      newState,
      nextContext,
    );

  // shouldUpdate为true，就会调用componentWillUpdate和UNSAFE_componentWillUpdate生命周期
  // 为componentDidUpdate和getSnapshotBeforeUpdate标记update和snapshot副作用
  if (shouldUpdate) {
    // In order to support react-lifecycles-compat polyfilled components,
    // Unsafe lifecycles should not be invoked for components using the new APIs.
    if (
      !hasNewLifecycles &&
      (typeof instance.UNSAFE_componentWillUpdate === 'function' ||
        typeof instance.componentWillUpdate === 'function')
    ) {
      if (typeof instance.componentWillUpdate === 'function') {
        instance.componentWillUpdate(newProps, newState, nextContext);
      }
      if (typeof instance.UNSAFE_componentWillUpdate === 'function') {
        instance.UNSAFE_componentWillUpdate(newProps, newState, nextContext);
      }
    }
    if (typeof instance.componentDidUpdate === 'function') {
      workInProgress.flags |= Update;
    }
    if (typeof instance.getSnapshotBeforeUpdate === 'function') {
      workInProgress.flags |= Snapshot;
    }
  } else {
    // 不应该update，说明workInProgress的新老props和state相同
    // 但是workInProgress和currentFiber上的老props和state不一定相同
    // 为componentDidUpdate和getSnapshotBeforeUpdate加上update和snapshot副作用

    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    if (typeof instance.componentDidUpdate === 'function') {
      if (
        unresolvedOldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.flags |= Update;
      }
    }
    if (typeof instance.getSnapshotBeforeUpdate === 'function') {
      if (
        unresolvedOldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.flags |= Snapshot;
      }
    }

    // If shouldComponentUpdate returned false, we should still update the
    // memoized props/state to indicate that this work can be reused.
    // 更新workInProgress的memoizedProps和memoizedState
    workInProgress.memoizedProps = newProps;
    workInProgress.memoizedState = newState;
  }

  // Update the existing instance's state, props, and context pointers even
  // if shouldComponentUpdate returns false.
  // 更新组件实例的props state context
  instance.props = newProps;
  instance.state = newState;
  instance.context = nextContext;

  // 返回shouldUpdate
  return shouldUpdate;
}

export {
  adoptClassInstance,
  constructClassInstance,
  mountClassInstance,
  resumeMountClassInstance,
  updateClassInstance,
};
