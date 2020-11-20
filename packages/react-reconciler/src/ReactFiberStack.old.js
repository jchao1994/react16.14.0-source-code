/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';

export type StackCursor<T> = {|current: T|};

// stack初始为一个空数组
const valueStack: Array<any> = [];

let fiberStack: Array<Fiber | null>;

if (__DEV__) {
  fiberStack = [];
}

let index = -1;

function createCursor<T>(defaultValue: T): StackCursor<T> {
  return {
    current: defaultValue,
  };
}

function isEmpty(): boolean {
  return index === -1;
}

// 从栈中取出最近的给到cursor，同时将栈中赋值为null
function pop<T>(cursor: StackCursor<T>, fiber: Fiber): void {
  // 只有在stack的索引值大于等于0，是stack才执行pop操作
  if (index < 0) {
    if (__DEV__) {
      console.error('Unexpected pop.');
    }
    return;
  }

  if (__DEV__) {
    if (fiber !== fiberStack[index]) {
      console.error('Unexpected Fiber popped.');
    }
  }

  // 更新指针，将指针指向当前值，也就是回退一步
  cursor.current = valueStack[index];

  // 然后将当前值设置为null
  valueStack[index] = null;

  if (__DEV__) {
    fiberStack[index] = null;
  }

  // 索引值自减
  index--;
}

// 将cursor指向的存入栈中，同时将cursor指向最新的
function push<T>(cursor: StackCursor<T>, value: T, fiber: Fiber): void {
  // 每执行一次索引值自增一次
  index++;

  // 在这里我们可以看到当，cursor传入后，我们拿到它的current属性，将该值放入栈中的某个位置上
  valueStack[index] = cursor.current;

  if (__DEV__) {
    fiberStack[index] = fiber;
  }

  // 更新指针，赋值新值
  cursor.current = value;
}

function checkThatStackIsEmpty() {
  if (__DEV__) {
    if (index !== -1) {
      console.error(
        'Expected an empty stack. Something was not reset properly.',
      );
    }
  }
}

function resetStackAfterFatalErrorInDev() {
  if (__DEV__) {
    index = -1;
    valueStack.length = 0;
    fiberStack.length = 0;
  }
}

export {
  createCursor,
  isEmpty,
  pop,
  push,
  // DEV only:
  checkThatStackIsEmpty,
  resetStackAfterFatalErrorInDev,
};
