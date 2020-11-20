/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

export type TypeOfMode = number;

export const NoMode = 0b00000; // 无模式，一般不会使用
export const StrictMode = 0b00001; // 严格模式，不会渲染任何可见的 UI。它为其后代元素触发额外的检查和警告，尤其是用于检查是否存在废弃的API
// TODO: Remove BlockingMode and ConcurrentMode by reading from the root
// tag instead
export const BlockingMode = 0b00010; // 传统的React模式，render，hydrate都是这类模式
export const ConcurrentMode = 0b00100; // React17新出现的并发模式
export const ProfileMode = 0b01000; // 性能测试模式，这个一般我们可以在开发环境下，对性能进行测试时会经常使用
export const DebugTracingMode = 0b10000; // debug模式
