/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// Export all exports so that they're available in tests.
// We can't use export * from in Flow for some reason.
export {
  createPortal, // 将子节点渲染DOM节点中，但是该节点又脱离在DOM层次结构之外
  unstable_batchedUpdates,
  flushSync, // 组件内部同步更新state。flushSync刷新整个DOM树，并实际上强制完全重新渲染以进行一次调用内发生的更新。除非是特殊情况开发中基本不用这个API
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
  version, // React版本号
  findDOMNode, // 访问底层DOM的应急API，已废弃
  hydrate, // 服务端渲染入口
  render, // 最为常用的客户端渲染入口
  unmountComponentAtNode, // 卸载组件
  createRoot,
  createRoot as unstable_createRoot,
  createBlockingRoot,
  createBlockingRoot as unstable_createBlockingRoot,
  unstable_flushControlled,
  unstable_scheduleHydration,
  unstable_runWithPriority,
  unstable_renderSubtreeIntoContainer,
  unstable_createPortal,
  unstable_createEventHandle,
  unstable_isNewReconciler,
} from './src/client/ReactDOM';
