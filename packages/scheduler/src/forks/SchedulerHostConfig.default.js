/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {enableIsInputPending} from '../SchedulerFeatureFlags';

export let requestHostCallback;
export let cancelHostCallback;
export let requestHostTimeout;
export let cancelHostTimeout;
export let shouldYieldToHost;
export let requestPaint;
export let getCurrentTime;
export let forceFrameRate;

const hasPerformanceNow =
  typeof performance === 'object' && typeof performance.now === 'function';

if (hasPerformanceNow) {
  const localPerformance = performance;
  // 获取从最开始到现在的时间
  getCurrentTime = () => localPerformance.now();
} else {
  const localDate = Date;
  const initialTime = localDate.now();
  // 获取从最开始到现在的时间
  getCurrentTime = () => localDate.now() - initialTime;
}

if (
  // If Scheduler runs in a non-DOM environment, it falls back to a naive
  // implementation using setTimeout.
  typeof window === 'undefined' ||
  // Check if MessageChannel is supported, too.
  typeof MessageChannel !== 'function'
) {
  // If this accidentally gets imported in a non-browser environment, e.g. JavaScriptCore,
  // fallback to a naive implementation.
  let _callback = null;
  let _timeoutID = null;
  const _flushCallback = function() {
    if (_callback !== null) {
      try {
        const currentTime = getCurrentTime();
        const hasRemainingTime = true;
        _callback(hasRemainingTime, currentTime);
        _callback = null;
      } catch (e) {
        setTimeout(_flushCallback, 0);
        throw e;
      }
    }
  };
  requestHostCallback = function(cb) {
    if (_callback !== null) {
      // Protect against re-entrancy.
      setTimeout(requestHostCallback, 0, cb);
    } else {
      _callback = cb;
      setTimeout(_flushCallback, 0);
    }
  };
  cancelHostCallback = function() {
    _callback = null;
  };
  requestHostTimeout = function(cb, ms) {
    _timeoutID = setTimeout(cb, ms);
  };
  cancelHostTimeout = function() {
    clearTimeout(_timeoutID);
  };
  shouldYieldToHost = function() {
    return false;
  };
  requestPaint = forceFrameRate = function() {};
} else {
  // Capture local references to native APIs, in case a polyfill overrides them.
  // fiber架构异步更新依赖浏览器原生api window.requestAnimationFrame window.cancelAnimationFrame

  const setTimeout = window.setTimeout;
  const clearTimeout = window.clearTimeout;

  if (typeof console !== 'undefined') {
    // TODO: Scheduler no longer requires these methods to be polyfilled. But
    // maybe we want to continue warning if they don't exist, to preserve the
    // option to rely on it in the future?
    const requestAnimationFrame = window.requestAnimationFrame;
    const cancelAnimationFrame = window.cancelAnimationFrame;

    if (typeof requestAnimationFrame !== 'function') {
      // Using console['error'] to evade Babel and ESLint
      console['error'](
        "This browser doesn't support requestAnimationFrame. " +
          'Make sure that you load a ' +
          'polyfill in older browsers. https://reactjs.org/link/react-polyfills',
      );
    }
    if (typeof cancelAnimationFrame !== 'function') {
      // Using console['error'] to evade Babel and ESLint
      console['error'](
        "This browser doesn't support cancelAnimationFrame. " +
          'Make sure that you load a ' +
          'polyfill in older browsers. https://reactjs.org/link/react-polyfills',
      );
    }
  }

  let isMessageLoopRunning = false;
  let scheduledHostCallback = null;
  let taskTimeoutID = -1;

  // Scheduler periodically yields in case there is other work on the main
  // thread, like user events. By default, it yields multiple times per frame.
  // It does not attempt to align with frame boundaries, since most tasks don't
  // need to be frame aligned; for those that do, use requestAnimationFrame.
  // 每帧的时间设置为5ms
  let yieldInterval = 5;
  let deadline = 0;

  // TODO: Make this configurable
  // TODO: Adjust this based on priority?
  const maxYieldInterval = 300;
  let needsPaint = false;

  // 兼容性处理navigator.scheduling
  // 设置shouldYieldToHost和requestPaint
  if (
    enableIsInputPending &&
    navigator !== undefined &&
    navigator.scheduling !== undefined &&
    navigator.scheduling.isInputPending !== undefined
  ) {
    const scheduling = navigator.scheduling;
    // 是否需要移交控制给浏览器
    // 超时/需要重绘为true，否则为false
    shouldYieldToHost = function() {
      const currentTime = getCurrentTime();
      if (currentTime >= deadline) {
        // There's no time left. We may want to yield control of the main
        // thread, so the browser can perform high priority tasks. The main ones
        // are painting and user input. If there's a pending paint or a pending
        // input, then we should yield. But if there's neither, then we can
        // yield less often while remaining responsive. We'll eventually yield
        // regardless, since there could be a pending paint that wasn't
        // accompanied by a call to `requestPaint`, or other main thread tasks
        // like network events.
        if (needsPaint || scheduling.isInputPending()) {
          // There is either a pending paint or a pending input.
          return true;
        }
        // There's no pending input. Only yield if we've reached the max
        // yield interval.
        return currentTime >= maxYieldInterval;
      } else {
        // There's still time left in the frame.
        return false;
      }
    };

    requestPaint = function() {
      needsPaint = true;
    };
  } else {
    // `isInputPending` is not available. Since we have no way of knowing if
    // there's pending input, always yield at the end of the frame.
    shouldYieldToHost = function() {
      return getCurrentTime() >= deadline;
    };

    // Since we yield every frame regardless, `requestPaint` has no effect.
    requestPaint = function() {};
  }

  // fps只支持0到125
  forceFrameRate = function(fps) {
    if (fps < 0 || fps > 125) {
      // Using console['error'] to evade Babel and ESLint
      console['error'](
        'forceFrameRate takes a positive int between 0 and 125, ' +
          'forcing frame rates higher than 125 fps is not supported',
      );
      return;
    }
    if (fps > 0) {
      yieldInterval = Math.floor(1000 / fps);
    } else {
      // reset the framerate
      yieldInterval = 5;
    }
  };

  // 这里会循环执行 scheduledHostCallback => flushWork => workLoop，直到异步更新完taskQueue中的所有任务
  const performWorkUntilDeadline = () => {
    if (scheduledHostCallback !== null) {
      const currentTime = getCurrentTime();
      // Yield after `yieldInterval` ms, regardless of where we are in the vsync
      // cycle. This means there's always time remaining at the beginning of
      // the message event.
      // 当前时间(从最开始到现在的时间) 加上 每帧留给react的时间(一般为5ms)，即为超时时间
      // 也就是定义超时时间deadline为当前的基础上加上 每帧留给react的时间(一般为5ms)
      // 这个超时时间用在shouldYieldToHost中，用于判断是否需要移交控制给浏览器
      deadline = currentTime + yieldInterval;
      const hasTimeRemaining = true;
      try {
        // taskQueue被中断的话，这里为true，否则为false
        const hasMoreWork = scheduledHostCallback(
          hasTimeRemaining,
          currentTime,
        );
        if (!hasMoreWork) {
          // taskQueue中没有任务，标记isMessageLoopRunning为false，重置scheduledHostCallback为null，结束循环
          isMessageLoopRunning = false;
          scheduledHostCallback = null;
        } else {
          // If there's more work, schedule the next message event at the end
          // of the preceding one.
          // taskQueue被中断，继续触发performWorkUntilDeadline
          // 这里会一直调用 scheduledHostCallback => flushWork => workLoop，直到异步更新完taskQueue中的所有任务
          // 具体流程
          // performWorkUntilDeadline => scheduledHostCallback(也就是flushWork)
          // => workLoop(遍历执行taskQueue中的任务，也就是performConcurrentWorkOnRoot)
          // => renderRootConcurrent => workLoopConcurrent(这里就会判断是否需要移交控制权，然后决定是否执行performUnitOfWork)
          // => 如果中断，taskQueue中的performConcurrentWorkOnRoot对应的task任务不会清除，同时跳出更新，返回true到hasMoreWork => port.postMessage(null) 宏任务 => 触发下一次performWorkUntilDeadline => ...
          //    如果没有中断，返回false到hasMoreWork，结束taskQueue中的更新。如果有timeQueue，会在延时到了之后推入taskQueue开始更新
          port.postMessage(null);
        }
      } catch (error) {
        // If a scheduler task throws, exit the current browser task so the
        // error can be observed.
        port.postMessage(null);
        throw error;
      }
    } else {
      // 没有scheduledHostCallback，标记isMessageLoopRunning为false，结束循环
      isMessageLoopRunning = false;
    }
    // Yielding to the browser will give it a chance to paint, so we can
    // reset this.
    // 这里设置needsPaint为false，这个needsPaint用在shouldYieldToHost中，用于判断是否需要移交控制给浏览器
    needsPaint = false;
  };

  // 创建一个新的消息通道，并通过它的两个MessagePort属性发送数据
  // 宏任务
  const channel = new MessageChannel();
  const port = channel.port2;
  // onmessage的执行实际很重要
  // react给单次performWorkUntilDeadline的时间只有5ms，一旦超过5ms，必须移交控制权给浏览器，浏览器处理requestAnimationFrame、页面渲染绘制
  // 等到浏览器自己的工作完成了，会执行宏任务，也就是下一个performWorkUntilDeadline
  // react用这种方式模拟了requestIdleCallback(由于兼容性问题没有采用)
  // 保证给浏览器单帧的工作时间理论上是 1000/60-5=11.67ms(60Hz刷新率)
  // 但是无法保证单次performWorkUntilDeadline中的最后一个单元任务的结束时间会超过5ms多久，理论上切成单元任务之后不会超出5ms很多
  // 而留给浏览器的11.67ms其实是有余量的(浏览器不需要这么久)，所有理论上是不会造成页面卡顿
  channel.port1.onmessage = performWorkUntilDeadline;

  // 设置requestHostCallback，并触发performWorkUntilDeadline
  requestHostCallback = function(callback) {
    scheduledHostCallback = callback;
    if (!isMessageLoopRunning) {
      isMessageLoopRunning = true;
      port.postMessage(null);
    }
  };

  cancelHostCallback = function() {
    scheduledHostCallback = null;
  };

  // 设置taskTimeoutID，延时ms后执行callback
  requestHostTimeout = function(callback, ms) {
    taskTimeoutID = setTimeout(() => {
      callback(getCurrentTime());
    }, ms);
  };

  cancelHostTimeout = function() {
    clearTimeout(taskTimeoutID);
    taskTimeoutID = -1;
  };
}
