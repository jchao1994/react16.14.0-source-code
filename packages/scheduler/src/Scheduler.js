/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* eslint-disable no-var */

import {
  enableSchedulerDebugging,
  enableProfiling,
} from './SchedulerFeatureFlags';
import {
  requestHostCallback,
  requestHostTimeout,
  cancelHostTimeout,
  shouldYieldToHost,
  getCurrentTime,
  forceFrameRate,
  requestPaint,
} from './SchedulerHostConfig';
import {push, pop, peek} from './SchedulerMinHeap';

// TODO: Use symbols?
import {
  ImmediatePriority,
  UserBlockingPriority,
  NormalPriority,
  LowPriority,
  IdlePriority,
} from './SchedulerPriorities';
import {
  sharedProfilingBuffer,
  markTaskRun,
  markTaskYield,
  markTaskCompleted,
  markTaskCanceled,
  markTaskErrored,
  markSchedulerSuspended,
  markSchedulerUnsuspended,
  markTaskStart,
  stopLoggingProfilingEvents,
  startLoggingProfilingEvents,
} from './SchedulerProfiling';

// Max 31 bit integer. The max integer size in V8 for 32-bit systems.
// Math.pow(2, 30) - 1
// 0b111111111111111111111111111111
var maxSigned31BitInt = 1073741823;

// Times out immediately
var IMMEDIATE_PRIORITY_TIMEOUT = -1;
// Eventually times out
var USER_BLOCKING_PRIORITY_TIMEOUT = 250;
var NORMAL_PRIORITY_TIMEOUT = 5000;
var LOW_PRIORITY_TIMEOUT = 10000;
// Never times out
var IDLE_PRIORITY_TIMEOUT = maxSigned31BitInt;

// Tasks are stored on a min heap
var taskQueue = [];
var timerQueue = [];

// Incrementing id counter. Used to maintain insertion order.
var taskIdCounter = 1;

// Pausing the scheduler is useful for debugging.
var isSchedulerPaused = false;

var currentTask = null;
var currentPriorityLevel = NormalPriority;

// This is set while performing work, to prevent re-entrancy.
var isPerformingWork = false;

var isHostCallbackScheduled = false;
var isHostTimeoutScheduled = false;

// 将timerQueue前端所有开始时间早于当前时间的timer移出timerQueue，并push到taskQueue中
// 更新timerQueue和taskQueue
function advanceTimers(currentTime) {
  // Check for tasks that are no longer delayed and add them to the queue.
  let timer = peek(timerQueue);
  while (timer !== null) {
    if (timer.callback === null) {
      // Timer was cancelled.
      pop(timerQueue);
    } else if (timer.startTime <= currentTime) {
      // Timer fired. Transfer to the task queue.
      // timer的开始时间早于当前时间，将其移出timerQueue，并push到taskQueue中
      pop(timerQueue);
      timer.sortIndex = timer.expirationTime;
      push(taskQueue, timer);
      if (enableProfiling) {
        markTaskStart(timer, currentTime);
        timer.isQueued = true;
      }
    } else {
      // Remaining timers are pending.
      // timer的开始时间仍未到
      return;
    }
    timer = peek(timerQueue);
  }
}

// timerQueue中的timer延时时间到了，会执行这个方法handleTimeout
// 先将timerQueue中startTime到了的任务更新到taskQueue中
// 然后判断taskQueue中是否有任务，有就执行requestHostCallback，next tick就会执行flushWork来处理
// 如果taskQueue中没有任务，继续处理timerQueue中的任务，取其第一个firstTimer执行requestHostTimeout
function handleTimeout(currentTime) {
  isHostTimeoutScheduled = false;
  advanceTimers(currentTime);

  if (!isHostCallbackScheduled) {
    if (peek(taskQueue) !== null) {
      // taskQueueb不为空
      isHostCallbackScheduled = true;
      // 设置scheduledCallback为flushWork
      requestHostCallback(flushWork);
    } else {
      // taskQueueb为空
      // 取timerQueue的第一个
      const firstTimer = peek(timerQueue);
      if (firstTimer !== null) {
        // 设置taskTimeoutID，延迟firstTimer.startTime - currentTime后执行handleTimeout
        requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
      }
    }
  }
}

// flushWork函数是作为scheduledCallback执行，其核心逻辑是workLoop
// workLoop是fiber架构异步更新的原理
// 遍历taskQueue中的所有task
// 一旦有任务没有超时，并且当前帧没有空闲时间了，跳出循环，去处理高优先级的任务
// 等到空闲的时候，再继续调用workLoop来处理taskQueue中剩下的任务
// currentTask处理过程中遇到中断，返回true标记
// taskQueue全部处理完毕，继续处理timerQueue，返回false标记
// hasTimeRemaining 当前帧是否有剩余时间
// initialTime 当前时间，也就是当前帧的开始时间
function flushWork(hasTimeRemaining, initialTime) {
  if (enableProfiling) {
    markSchedulerUnsuspended(initialTime);
  }

  // We'll need a host callback the next time work is scheduled.
  isHostCallbackScheduled = false;
  // 目前调度的就是timeout事件，将其清空
  if (isHostTimeoutScheduled) {
    // We scheduled a timeout but it's no longer needed. Cancel it.
    isHostTimeoutScheduled = false;
    cancelHostTimeout();
  }

  // 标记正在执行work
  isPerformingWork = true;
  const previousPriorityLevel = currentPriorityLevel;
  try {
    if (enableProfiling) {
      try {
        return workLoop(hasTimeRemaining, initialTime);
      } catch (error) {
        if (currentTask !== null) {
          const currentTime = getCurrentTime();
          markTaskErrored(currentTask, currentTime);
          currentTask.isQueued = false;
        }
        throw error;
      }
    } else {
      // No catch in prod code path.
      // 遍历taskQueue中的所有task
      // 一旦有任务没有超时，并且当前帧没有空闲时间了，跳出循环，去处理高优先级的任务
      // 等到空闲的时候，再继续调用workLoop来处理taskQueue中剩下的任务
      // currentTask处理过程中遇到中断，返回true标记
      // taskQueue全部处理完毕，继续处理timerQueue，返回false标记
      return workLoop(hasTimeRemaining, initialTime);
    }
  } finally {
    // 执行完毕
    // 重置currentTask为null
    // 重置currentPriorityLevel为原previousPriorityLevel
    // 重置isPerformingWork为false
    currentTask = null;
    currentPriorityLevel = previousPriorityLevel;
    isPerformingWork = false;
    if (enableProfiling) {
      const currentTime = getCurrentTime();
      markSchedulerSuspended(currentTime);
    }
  }
}

// fiber架构异步更新的原理
// 遍历taskQueue中的所有task
// 一旦有任务没有超时，并且当前帧没有空闲时间了，跳出循环，去处理高优先级的任务
// 等到空闲的时候，再继续调用workLoop来处理taskQueue中剩下的任务
// currentTask处理过程中遇到中断，返回true标记
// taskQueue全部处理完毕，继续处理timerQueue，返回false标记
function workLoop(hasTimeRemaining, initialTime) {
  let currentTime = initialTime;
  // 将timerQueue前端所有开始时间早于当前时间currentTime的timer移出timerQueue，并push到taskQueue中
  // 更新timerQueue和taskQueue
  advanceTimers(currentTime);
  // 取taskQueue中的第一个作为当前任务currentTask
  currentTask = peek(taskQueue);
  // 遍历taskQueue中的所有task
  // 一旦有任务没有超时，并且当前帧没有空闲时间了，跳出循环，去处理高优先级的任务
  // 等到空闲的时候，再继续调用workLoop来处理taskQueue中剩下的任务
  while (
    currentTask !== null &&
    !(enableSchedulerDebugging && isSchedulerPaused)
  ) {
    if (
      currentTask.expirationTime > currentTime &&
      (!hasTimeRemaining || shouldYieldToHost())
    ) {
      // This currentTask hasn't expired, and we've reached the deadline.
      // 当前任务currentTask还没有超时，并且当前帧没有空闲时间了，跳出循环，去处理高优先级的任务
      // shouldYieldToHost 是否需要移交控制给浏览器，超时/需要重绘为true，否则为false
      break;
    }
    const callback = currentTask.callback;
    if (typeof callback === 'function') {
      // currentTask有callback，执行callback，并根据didUserCallbackTimeout做相应处理
      currentTask.callback = null;
      currentPriorityLevel = currentTask.priorityLevel;
      // https://developer.mozilla.org/zh-CN/docs/Web/API/IdleDeadline
      // didUserCallbackTimeout同IdleDeadline.didTimeout
      // true表示callback正在被执行(并且上一次执行回调函数执行的时候由于时间超时回调函数得不到执行)，因为在执行requestIdleCallback回调的时候指定了超时时间并且时间已经超时
      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime;
      markTaskRun(currentTask, currentTime);
      const continuationCallback = callback(didUserCallbackTimeout);
      // 执行完callback，更新当前时间currentTime
      currentTime = getCurrentTime();
      // 对didUserCallbackTimeout的task做不同的标记
      // 由于didUserCallbackTimeout的task在前一次已经做了pop处理，所以这里不用做重复处理
      if (typeof continuationCallback === 'function') {
        currentTask.callback = continuationCallback;
        markTaskYield(currentTask, currentTime);
      } else {
        if (enableProfiling) {
          markTaskCompleted(currentTask, currentTime);
          currentTask.isQueued = false;
        }
        if (currentTask === peek(taskQueue)) {
          pop(taskQueue);
        }
      }
      // 更新timerQueue和taskQueue
      advanceTimers(currentTime);
    } else {
      // currentTask没有callback，直接从taskQueue中移除
      pop(taskQueue);
    }
    // 继续遍历下一个task
    currentTask = peek(taskQueue);
  }
  // Return whether there's additional work
  if (currentTask !== null) {
    // currentTask处理过程中遇到中断，返回true标记
    return true;
  } else {
    // taskQueue全部处理完毕，继续处理timerQueue，返回false标记
    const firstTimer = peek(timerQueue);
    if (firstTimer !== null) {
      // 设置scheduledTimeout和timeoutTime
      requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
    }
    return false;
  }
}

// 设置最新的优先级，然后执行回调
function unstable_runWithPriority(priorityLevel, eventHandler) {
  switch (priorityLevel) {
    case ImmediatePriority: // 1
    case UserBlockingPriority: // 2
    case NormalPriority: // 3
    case LowPriority: // 4
    case IdlePriority: // 5
      break;
    default:
      priorityLevel = NormalPriority;
  }

  var previousPriorityLevel = currentPriorityLevel; // 当前优先级
  currentPriorityLevel = priorityLevel; // 最新优先级

  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previousPriorityLevel; // 返回之前的优先级
  }
}

function unstable_next(eventHandler) {
  var priorityLevel;
  switch (currentPriorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
      // Shift down to normal priority
      priorityLevel = NormalPriority;
      break;
    default:
      // Anything lower than normal priority should remain at the current level.
      priorityLevel = currentPriorityLevel;
      break;
  }

  var previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;

  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previousPriorityLevel;
  }
}

function unstable_wrapCallback(callback) {
  var parentPriorityLevel = currentPriorityLevel;
  return function () {
    // This is a fork of runWithPriority, inlined for performance.
    var previousPriorityLevel = currentPriorityLevel;
    currentPriorityLevel = parentPriorityLevel;

    try {
      return callback.apply(this, arguments);
    } finally {
      currentPriorityLevel = previousPriorityLevel;
    }
  };
}

// 将callback封装成一个newTask对象，根据其startTime判断将其push到timerQueue或taskQueue中
// 然后执行对应的requestHostTimeout或requestHostCallback
// 最后返回这个newTask对象
// 这个方法会设置scheduledHostCallback为callback，并在next tick也就是channel.port1.onmessage触发performWorkUntilDeadline
// performWorkUntilDeadline会循环执行 scheduledHostCallback => flushWork => workLoop，直到异步更新完taskQueue中的所有任务
// flushWork函数是作为scheduledCallback执行，其核心逻辑是workLoop
// workLoop是fiber架构异步更新的原理
// 遍历taskQueue中的所有task
// 一旦有任务没有超时，并且当前帧没有空闲时间了，跳出循环，去处理高优先级的任务
// 等到空闲的时候，再继续调用workLoop来处理taskQueue中剩下的任务
// currentTask处理过程中遇到中断，返回true标记
// taskQueue全部处理完毕，继续处理timerQueue，返回false标记
// 启动遍历同步队列的flushSyncCallbackQueueImpl在这里作为第一个newTask推入taskQueue或timerQueue
function unstable_scheduleCallback(priorityLevel, callback, options) {
  // 返回currentTime
  var currentTime = getCurrentTime();

  // startTime = currentTime + delay
  var startTime;
  if (typeof options === 'object' && options !== null) {
    var delay = options.delay;
    if (typeof delay === 'number' && delay > 0) {
      startTime = currentTime + delay;
    } else {
      startTime = currentTime;
    }
  } else {
    startTime = currentTime;
  }

  // 根据优先级生成timeout 优先级最高，timeout越小
  var timeout;
  switch (priorityLevel) {
    case ImmediatePriority:
      timeout = IMMEDIATE_PRIORITY_TIMEOUT;
      break;
    case UserBlockingPriority:
      timeout = USER_BLOCKING_PRIORITY_TIMEOUT;
      break;
    case IdlePriority:
      timeout = IDLE_PRIORITY_TIMEOUT;
      break;
    case LowPriority:
      timeout = LOW_PRIORITY_TIMEOUT;
      break;
    case NormalPriority:
    default:
      timeout = NORMAL_PRIORITY_TIMEOUT;
      break;
  }

  // 过期时间为startTime + timeout
  var expirationTime = startTime + timeout;

  // 生成新的newTask对象
  var newTask = {
    id: taskIdCounter++,
    callback,
    priorityLevel,
    startTime,
    expirationTime,
    sortIndex: -1,
  };
  if (enableProfiling) {
    newTask.isQueued = false;
  }

  // 根据是否有delay分别处理
  // 有delay，存放在timerQueue
  // 无delay，存放在taskQueue
  if (startTime > currentTime) {
    // This is a delayed task.
    // 说明有delay
    // sortIndex设为startTime
    newTask.sortIndex = startTime;
    // 将newTask推入timerQueue，并根据sortIndex和id对timerQueue做增序排序
    // 也就是根据startTime对timerQueue进行排序
    push(timerQueue, newTask);
    // taskQueue中没有任务，且当前newTask是timerQueue中的第一个，执行requestHostTimeout
    if (peek(taskQueue) === null && newTask === peek(timerQueue)) {
      // All tasks are delayed, and this is the task with the earliest delay.
      if (isHostTimeoutScheduled) {
        // Cancel an existing timeout.
        // 重置scheduledTimeout和timeoutTime
        cancelHostTimeout();
      } else {
        isHostTimeoutScheduled = true;
      }
      // Schedule a timeout.
      // 设置taskTimeoutID，延迟startTime - currentTime后执行handleTimeout
      requestHostTimeout(handleTimeout, startTime - currentTime);
    }
  } else {
    // 没有delay
    // sortIndex设为expirationTime  startTime + timeout
    newTask.sortIndex = expirationTime;
    push(taskQueue, newTask);
    if (enableProfiling) {
      markTaskStart(newTask, currentTime);
      newTask.isQueued = true;
    }
    // Schedule a host callback, if needed. If we're already performing work,
    // wait until the next time we yield.
    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true;
      // 设置scheduledHostCallback为callback，并在next tick也就是channel.port1.onmessage触发performWorkUntilDeadline
      // performWorkUntilDeadline会循环执行 scheduledHostCallback => flushWork => workLoop，直到异步更新完taskQueue中的所有任务
      // flushWork函数是作为scheduledHostCallback执行，其核心逻辑是workLoop
      // workLoop是fiber架构异步更新的原理
      // 遍历taskQueue中的所有task
      // 一旦有任务没有超时，并且当前帧没有空闲时间了，跳出循环，去处理高优先级的任务
      // 等到空闲的时候，再继续调用workLoop来处理taskQueue中剩下的任务
      // currentTask处理过程中遇到中断，返回true标记
      // taskQueue全部处理完毕，继续处理timerQueue，返回false标记
      requestHostCallback(flushWork);
    }
  }

  return newTask;
}

function unstable_pauseExecution() {
  isSchedulerPaused = true;
}

function unstable_continueExecution() {
  isSchedulerPaused = false;
  if (!isHostCallbackScheduled && !isPerformingWork) {
    isHostCallbackScheduled = true;
    requestHostCallback(flushWork);
  }
}

function unstable_getFirstCallbackNode() {
  return peek(taskQueue);
}

function unstable_cancelCallback(task) {
  if (enableProfiling) {
    if (task.isQueued) {
      const currentTime = getCurrentTime();
      markTaskCanceled(task, currentTime);
      task.isQueued = false;
    }
  }

  // Null out the callback to indicate the task has been canceled. (Can't
  // remove from the queue because you can't remove arbitrary nodes from an
  // array based heap, only the first one.)
  task.callback = null;
}

function unstable_getCurrentPriorityLevel() {
  return currentPriorityLevel;
}

const unstable_requestPaint = requestPaint;

export {
  ImmediatePriority as unstable_ImmediatePriority,
  UserBlockingPriority as unstable_UserBlockingPriority,
  NormalPriority as unstable_NormalPriority,
  IdlePriority as unstable_IdlePriority,
  LowPriority as unstable_LowPriority,
  unstable_runWithPriority,
  unstable_next,
  unstable_scheduleCallback,
  unstable_cancelCallback,
  unstable_wrapCallback,
  unstable_getCurrentPriorityLevel,
  shouldYieldToHost as unstable_shouldYield,
  unstable_requestPaint,
  unstable_continueExecution,
  unstable_pauseExecution,
  unstable_getFirstCallbackNode,
  getCurrentTime as unstable_now,
  forceFrameRate as unstable_forceFrameRate,
};

export const unstable_Profiling = enableProfiling
  ? {
      startLoggingProfilingEvents,
      stopLoggingProfilingEvents,
      sharedProfilingBuffer,
    }
  : null;
