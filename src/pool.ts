import type { ManagedWorker, WorkerAdapter } from "./adapters/base.js";
import type {
  ChannelValue,
  PuruConfig,
  StructuredCloneValue,
  Task,
  TaskError,
  WorkerMessage,
  WorkerResponse,
} from "./types.js";
import { getConfig } from "./configure.js";
import { detectRuntime, detectCapability } from "./runtime.js";
import { NodeWorkerAdapter } from "./adapters/node.js";
import { BunWorkerAdapter } from "./adapters/bun.js";
import { InlineAdapter } from "./adapters/inline.js";
import { getChannelById } from "./channel.js";

interface PriorityQueues {
  high: Task[];
  normal: Task[];
  low: Task[];
}

export class WorkerPool {
  private config: PuruConfig;
  private adapter: WorkerAdapter;
  private idleWorkers: ManagedWorker[] = [];
  private exclusiveWorkers = new Map<string, ManagedWorker>();
  private sharedWorkers = new Map<ManagedWorker, Set<string>>();
  private queues: PriorityQueues = {
    high: [] as Task[],
    normal: [] as Task[],
    low: [] as Task[],
  };
  private concurrentQueues: PriorityQueues = {
    high: [] as Task[],
    normal: [] as Task[],
    low: [] as Task[],
  };
  private allWorkers = new Set<ManagedWorker>();
  private idleTimers = new Map<ManagedWorker, ReturnType<typeof setTimeout>>();
  private pendingWorkerCount = 0;
  private pendingTasksForWorkers: Task[] = [];
  private draining = false;
  private totalCompleted = 0;
  private totalFailed = 0;
  private taskMap = new Map<string, Task>();
  private workerFunctionIds = new Map<ManagedWorker, Set<string>>();

  // Per-worker deques for work-stealing strategy
  private workerDeques = new Map<ManagedWorker, PriorityQueues>();

  constructor(config: PuruConfig, adapter: WorkerAdapter) {
    this.config = config;
    this.adapter = adapter;
  }

  // --- Queue helpers ---

  private enqueue(task: Task): void {
    this.queues[task.priority].push(task);
  }

  private dequeue(): Task | undefined {
    return this.queues.high.shift() ?? this.queues.normal.shift() ?? this.queues.low.shift();
  }

  private enqueueConcurrent(task: Task): void {
    this.concurrentQueues[task.priority].push(task);
  }

  private dequeueConcurrent(): Task | undefined {
    return (
      this.concurrentQueues.high.shift() ??
      this.concurrentQueues.normal.shift() ??
      this.concurrentQueues.low.shift()
    );
  }

  private removeFromQueue(taskId: string): Task | undefined {
    for (const priority of ["high", "normal", "low"] as const) {
      const queue = this.queues[priority];
      const idx = queue.findIndex((t) => t.id === taskId);
      if (idx !== -1) {
        return queue.splice(idx, 1)[0];
      }
    }
    return undefined;
  }

  private removeFromConcurrentQueue(taskId: string): Task | undefined {
    for (const priority of ["high", "normal", "low"] as const) {
      const queue = this.concurrentQueues[priority];
      const idx = queue.findIndex((t) => t.id === taskId);
      if (idx !== -1) {
        return queue.splice(idx, 1)[0];
      }
    }
    return undefined;
  }

  // --- Work-stealing helpers ---

  private getOrCreateDeque(worker: ManagedWorker): PriorityQueues {
    let deque = this.workerDeques.get(worker);
    if (!deque) {
      deque = { high: [], normal: [], low: [] };
      this.workerDeques.set(worker, deque);
    }
    return deque;
  }

  private dequeSize(worker: ManagedWorker): number {
    const deque = this.workerDeques.get(worker);
    if (!deque) return 0;
    return deque.high.length + deque.normal.length + deque.low.length;
  }

  private enqueueToWorker(worker: ManagedWorker, task: Task): void {
    this.getOrCreateDeque(worker)[task.priority].push(task);
  }

  /** Pop from own deque — FIFO within each priority level. */
  private dequeueFromOwn(worker: ManagedWorker): Task | undefined {
    const deque = this.workerDeques.get(worker);
    if (!deque) return undefined;
    return deque.high.shift() ?? deque.normal.shift() ?? deque.low.shift();
  }

  /** Steal from a victim's deque — takes lowest-priority work from the back. */
  private stealFrom(victim: ManagedWorker): Task | undefined {
    const deque = this.workerDeques.get(victim);
    if (!deque) return undefined;
    return deque.low.pop() ?? deque.normal.pop() ?? deque.high.pop();
  }

  /** Find the exclusive worker with the shortest deque to push a new task to. */
  private findShortestDequeWorker(): ManagedWorker | undefined {
    let best: ManagedWorker | undefined;
    let bestSize = Infinity;
    const seen = new Set<ManagedWorker>();
    for (const worker of this.exclusiveWorkers.values()) {
      if (seen.has(worker)) continue;
      seen.add(worker);
      const size = this.dequeSize(worker);
      if (size < bestSize) {
        bestSize = size;
        best = worker;
      }
    }
    return best;
  }

  /** Steal a task from the busiest worker's deque, excluding the thief. */
  private stealFromBusiest(thief: ManagedWorker): Task | undefined {
    let victim: ManagedWorker | undefined;
    let maxSize = 0;
    for (const [worker, deque] of this.workerDeques) {
      if (worker === thief) continue;
      const size = deque.high.length + deque.normal.length + deque.low.length;
      if (size > maxSize) {
        maxSize = size;
        victim = worker;
      }
    }
    if (!victim || maxSize === 0) return undefined;
    return this.stealFrom(victim);
  }

  /** Steal from any deque (no thief exclusion — used by resize). */
  private stealFromAny(): Task | undefined {
    let victim: ManagedWorker | undefined;
    let maxSize = 0;
    for (const [worker, deque] of this.workerDeques) {
      const size = deque.high.length + deque.normal.length + deque.low.length;
      if (size > maxSize) {
        maxSize = size;
        victim = worker;
      }
    }
    if (!victim || maxSize === 0) return undefined;
    return this.stealFrom(victim);
  }

  /** Remove a task by ID from any worker's deque. */
  private removeFromDeques(taskId: string): Task | undefined {
    for (const [, deque] of this.workerDeques) {
      for (const priority of ["high", "normal", "low"] as const) {
        const queue = deque[priority];
        const idx = queue.findIndex((t) => t.id === taskId);
        if (idx !== -1) {
          return queue.splice(idx, 1)[0];
        }
      }
    }
    return undefined;
  }

  /** Flush a worker's deque back to the global queue (for redistribution). */
  private flushDeque(worker: ManagedWorker): void {
    const deque = this.workerDeques.get(worker);
    if (!deque) return;
    for (const priority of ["high", "normal", "low"] as const) {
      for (const task of deque[priority]) {
        this.queues[priority].push(task);
      }
    }
    this.workerDeques.delete(worker);
  }

  /** Clean up a deque if it's empty. */
  private cleanupDeque(worker: ManagedWorker): void {
    if (this.dequeSize(worker) === 0) {
      this.workerDeques.delete(worker);
    }
  }

  // --- Submit ---

  submit(task: Task): void {
    if (this.draining) {
      task.reject(new Error("Pool is shutting down"));
      return;
    }

    if (task.concurrent) {
      this.submitConcurrent(task);
    } else {
      this.submitExclusive(task);
    }
  }

  private submitExclusive(task: Task): void {
    // Try to assign to an idle worker
    const worker = this.idleWorkers.pop();
    if (worker) {
      this.dispatch(worker, task);
      return;
    }

    // Try to create a new worker
    const totalWorkers = this.allWorkers.size + this.pendingWorkerCount;
    if (totalWorkers < this.config.maxThreads) {
      this.pendingWorkerCount++;
      this.pendingTasksForWorkers.push(task);
      this.createAndReadyWorker();
      return;
    }

    // Work-stealing: push to the busy worker with the shortest deque
    if (this.config.strategy === "work-stealing") {
      const target = this.findShortestDequeWorker();
      if (target) {
        this.enqueueToWorker(target, task);
        return;
      }
    }

    // FIFO fallback (or no exclusive workers for work-stealing)
    this.enqueue(task);
  }

  private submitConcurrent(task: Task): void {
    // 1. Find a shared worker under the concurrency limit
    for (const [worker, tasks] of this.sharedWorkers) {
      if (tasks.size < this.config.concurrency) {
        this.dispatchConcurrent(worker, task);
        return;
      }
    }

    // 2. Grab an idle worker and convert to shared mode
    const idleWorker = this.idleWorkers.pop();
    if (idleWorker) {
      this.dispatchConcurrent(idleWorker, task);
      return;
    }

    // 3. Spin up a new worker if under limit
    const totalWorkers = this.allWorkers.size + this.pendingWorkerCount;
    if (totalWorkers < this.config.maxThreads) {
      this.pendingWorkerCount++;
      this.pendingTasksForWorkers.push(task);
      this.createAndReadyWorker();
      return;
    }

    // 4. All workers busy/saturated — queue it
    this.enqueueConcurrent(task);
  }

  // --- Dispatch ---

  private dispatch(worker: ManagedWorker, task: Task): void {
    const timer = this.idleTimers.get(worker);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(worker);
    }

    worker.ref();
    this.exclusiveWorkers.set(task.id, worker);
    this.taskMap.set(task.id, task);

    const msg: WorkerMessage = {
      type: "execute",
      taskId: task.id,
      fnId: task.fnId,
      fnStr: this.getWorkerFunctionString(worker, task),
      args: task.args,
      concurrent: false,
      channels: task.channels,
    };
    worker.postMessage(msg);
  }

  private dispatchConcurrent(worker: ManagedWorker, task: Task): void {
    const timer = this.idleTimers.get(worker);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(worker);
    }

    worker.ref();

    if (!this.sharedWorkers.has(worker)) {
      this.sharedWorkers.set(worker, new Set());
    }
    this.sharedWorkers.get(worker)!.add(task.id);
    this.taskMap.set(task.id, task);

    const msg: WorkerMessage = {
      type: "execute",
      taskId: task.id,
      fnId: task.fnId,
      fnStr: this.getWorkerFunctionString(worker, task),
      args: task.args,
      concurrent: true,
      channels: task.channels,
    };
    worker.postMessage(msg);
  }

  private getWorkerFunctionString(worker: ManagedWorker, task: Task): string | undefined {
    let knownFunctions = this.workerFunctionIds.get(worker);
    if (!knownFunctions) {
      knownFunctions = new Set<string>();
      this.workerFunctionIds.set(worker, knownFunctions);
    }

    if (knownFunctions.has(task.fnId)) return undefined;
    knownFunctions.add(task.fnId);
    return task.fnStr;
  }

  // --- Task completion ---

  private handleWorkerMessage(worker: ManagedWorker, response: WorkerResponse): void {
    if (response.type === "channel-op") {
      this.handleChannelOp(worker, response);
      return;
    }

    if (response.type === "result") {
      const taskId = response.taskId;
      this.resolveTask(taskId, response.value);

      if (this.exclusiveWorkers.has(taskId)) {
        this.exclusiveWorkers.delete(taskId);
        this.assignNextOrIdle(worker);
      } else {
        const taskSet = this.sharedWorkers.get(worker);
        if (taskSet) {
          taskSet.delete(taskId);
          this.assignNextConcurrentOrIdle(worker);
        }
      }
    } else if (response.type === "error") {
      const taskId = response.taskId;
      const err = new Error(response.message);
      if (response.stack) err.stack = response.stack;
      // ReferenceError inside a worker almost always means the function captured
      // a variable from the enclosing scope. Surface a clear message rather than
      // a cryptic worker-internal stack trace.
      if (
        response.message.match(/^ReferenceError:/) ||
        response.message.match(/ is not defined$/)
      ) {
        err.message +=
          "\n  Hint: functions passed to spawn() cannot access variables from the enclosing scope. " +
          "Inline all required values directly in the function body, or pass them via the channels option.";
      }
      this.rejectTask(taskId, err);

      if (this.exclusiveWorkers.has(taskId)) {
        this.exclusiveWorkers.delete(taskId);
        this.assignNextOrIdle(worker);
      } else {
        const taskSet = this.sharedWorkers.get(worker);
        if (taskSet) {
          taskSet.delete(taskId);
          this.assignNextConcurrentOrIdle(worker);
        }
      }
    }
  }

  private assignNextOrIdle(worker: ManagedWorker): void {
    if (!this.allWorkers.has(worker)) return;

    if (this.config.strategy === "work-stealing") {
      // 1. Check own deque (FIFO — pop from front)
      const own = this.dequeueFromOwn(worker);
      if (own) {
        this.cleanupDeque(worker);
        this.dispatch(worker, own);
        return;
      }

      // 2. Steal from the busiest worker (LIFO — pop from back, lowest priority first)
      const stolen = this.stealFromBusiest(worker);
      if (stolen) {
        this.dispatch(worker, stolen);
        return;
      }
    }

    // FIFO: try exclusive queue (also serves as fallback for work-stealing)
    const next = this.dequeue();
    if (next) {
      this.dispatch(worker, next);
      return;
    }

    // Then try concurrent queue
    const concurrentNext = this.dequeueConcurrent();
    if (concurrentNext) {
      this.dispatchConcurrent(worker, concurrentNext);
      return;
    }

    this.cleanupDeque(worker);
    this.makeIdle(worker);
  }

  private assignNextConcurrentOrIdle(worker: ManagedWorker): void {
    if (!this.allWorkers.has(worker)) return;

    const taskSet = this.sharedWorkers.get(worker);
    const currentCount = taskSet?.size ?? 0;

    // Fill up to concurrency limit from concurrent queue
    let filled = currentCount;
    while (filled < this.config.concurrency) {
      const next = this.dequeueConcurrent();
      if (!next) break;
      this.dispatchConcurrent(worker, next);
      filled++;
    }

    // If no tasks remain, transition back
    const updatedSet = this.sharedWorkers.get(worker);
    if (!updatedSet || updatedSet.size === 0) {
      this.sharedWorkers.delete(worker);
      // Try exclusive queue before going idle
      const exclusiveTask = this.dequeue();
      if (exclusiveTask) {
        this.dispatch(worker, exclusiveTask);
      } else if (this.config.strategy === "work-stealing") {
        // Try stealing from busy workers' deques
        const stolen = this.stealFromBusiest(worker);
        if (stolen) {
          this.dispatch(worker, stolen);
        } else {
          this.makeIdle(worker);
        }
      } else {
        this.makeIdle(worker);
      }
    }
  }

  private makeIdle(worker: ManagedWorker): void {
    worker.unref();
    this.idleWorkers.push(worker);

    if (this.config.idleTimeout > 0) {
      const timer = setTimeout(() => {
        this.idleTimers.delete(worker);
        const idx = this.idleWorkers.indexOf(worker);
        if (idx !== -1) {
          this.idleWorkers.splice(idx, 1);
        }
        this.allWorkers.delete(worker);
        worker.terminate();
      }, this.config.idleTimeout);

      // Don't let the idle timer prevent process exit
      if (timer.unref) timer.unref();
      this.idleTimers.set(worker, timer);
    }
  }

  // --- Channel RPC ---

  private async handleChannelOp(
    worker: ManagedWorker,
    msg: Extract<WorkerResponse, { type: "channel-op" }>,
  ): Promise<void> {
    const channel = getChannelById(msg.channelId);

    if (!channel) {
      worker.postMessage({
        type: "channel-result",
        correlationId: msg.correlationId,
        error: `Channel ${msg.channelId} not found`,
      });
      return;
    }

    try {
      if (msg.op === "send") {
        await channel.send(msg.value as ChannelValue);
        worker.postMessage({
          type: "channel-result",
          correlationId: msg.correlationId,
        });
      } else if (msg.op === "recv") {
        const value = await channel.recv();
        worker.postMessage({
          type: "channel-result",
          correlationId: msg.correlationId,
          value,
        });
      } else if (msg.op === "close") {
        channel.close();
        worker.postMessage({
          type: "channel-result",
          correlationId: msg.correlationId,
        });
      }
    } catch (err) {
      worker.postMessage({
        type: "channel-result",
        correlationId: msg.correlationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- Task resolution ---

  private resolveTask(taskId: string, value: StructuredCloneValue): void {
    const task = this.taskMap.get(taskId);
    if (task) {
      this.taskMap.delete(taskId);
      this.totalCompleted++;
      task.resolve(value);
    }
  }

  private rejectTask(taskId: string, reason: TaskError): void {
    const task = this.taskMap.get(taskId);
    if (task) {
      this.taskMap.delete(taskId);
      this.totalFailed++;
      task.reject(reason);
    }
  }

  private rejectExclusiveTaskForWorker(worker: ManagedWorker, reason: TaskError): void {
    for (const [taskId, assignedWorker] of this.exclusiveWorkers) {
      if (assignedWorker === worker) {
        this.exclusiveWorkers.delete(taskId);
        this.rejectTask(taskId, reason);
        break;
      }
    }
  }

  // --- Cancellation ---

  cancelTask(taskId: string): void {
    // 1. Check exclusive queues
    const removed = this.removeFromQueue(taskId);
    if (removed) {
      removed.reject(new DOMException("Task was cancelled", "AbortError"));
      return;
    }

    // 1b. Check per-worker deques (work-stealing)
    if (this.config.strategy === "work-stealing") {
      const removedFromDeque = this.removeFromDeques(taskId);
      if (removedFromDeque) {
        removedFromDeque.reject(new DOMException("Task was cancelled", "AbortError"));
        return;
      }
    }

    // 2. Check concurrent queues
    const removedConcurrent = this.removeFromConcurrentQueue(taskId);
    if (removedConcurrent) {
      removedConcurrent.reject(new DOMException("Task was cancelled", "AbortError"));
      return;
    }

    // 3. Check exclusive workers — terminate the worker (existing behavior)
    const exclusiveWorker = this.exclusiveWorkers.get(taskId);
    if (exclusiveWorker) {
      this.exclusiveWorkers.delete(taskId);
      this.allWorkers.delete(exclusiveWorker);
      this.taskMap.delete(taskId);
      // Redistribute deque tasks before terminating the worker
      this.flushDeque(exclusiveWorker);
      exclusiveWorker.terminate();
      return;
    }

    // 4. Check shared workers — send cancel message, do NOT terminate
    for (const [worker, taskSet] of this.sharedWorkers) {
      if (taskSet.has(taskId)) {
        taskSet.delete(taskId);
        this.taskMap.delete(taskId);
        worker.postMessage({ type: "cancel", taskId });
        if (taskSet.size === 0) {
          this.sharedWorkers.delete(worker);
          this.assignNextConcurrentOrIdle(worker);
        }
        return;
      }
    }
  }

  // --- Lifecycle ---

  async drain(): Promise<void> {
    this.draining = true;

    // Reject all queued exclusive tasks
    for (const priority of ["high", "normal", "low"] as const) {
      for (const task of this.queues[priority]) {
        task.reject(new Error("Pool is shutting down"));
      }
      this.queues[priority] = [];
    }

    // Reject all queued concurrent tasks
    for (const priority of ["high", "normal", "low"] as const) {
      for (const task of this.concurrentQueues[priority]) {
        task.reject(new Error("Pool is shutting down"));
      }
      this.concurrentQueues[priority] = [];
    }

    // Reject all tasks in per-worker deques (work-stealing)
    for (const [, deque] of this.workerDeques) {
      for (const priority of ["high", "normal", "low"] as const) {
        for (const task of deque[priority]) {
          task.reject(new Error("Pool is shutting down"));
        }
      }
    }
    this.workerDeques.clear();

    // Clear in-flight exclusive tasks — their workers are about to be terminated.
    // We don't reject them here because the caller may not be listening, which
    // would cause unhandled rejection errors. The promises will simply never settle.
    for (const [taskId] of this.exclusiveWorkers) {
      this.taskMap.delete(taskId);
    }
    this.exclusiveWorkers.clear();

    // Same for in-flight concurrent tasks.
    for (const [, taskSet] of this.sharedWorkers) {
      for (const taskId of taskSet) {
        this.taskMap.delete(taskId);
      }
    }

    // Terminate all workers
    const terminatePromises: Promise<number>[] = [];
    for (const worker of this.allWorkers) {
      const timer = this.idleTimers.get(worker);
      if (timer) clearTimeout(timer);
      terminatePromises.push(worker.terminate());
    }

    await Promise.all(terminatePromises);

    this.idleWorkers = [];
    this.exclusiveWorkers.clear();
    this.sharedWorkers.clear();
    this.allWorkers.clear();
    this.idleTimers.clear();
    this.workerFunctionIds.clear();
  }

  resize(maxThreads: number): void {
    this.config = { ...this.config, maxThreads };

    // If we now have capacity, dequeue tasks and spin up workers
    while (true) {
      const totalWorkers = this.allWorkers.size + this.pendingWorkerCount;
      if (totalWorkers >= maxThreads) break;
      // Try exclusive queue first, then steal from deques, then concurrent
      const task =
        this.dequeue() ??
        (this.config.strategy === "work-stealing" ? this.stealFromAny() : undefined) ??
        this.dequeueConcurrent();
      if (!task) break;
      this.pendingWorkerCount++;
      this.pendingTasksForWorkers.push(task);
      this.createAndReadyWorker();
    }

    // If pool is now oversized, terminate excess idle workers
    while (this.allWorkers.size > maxThreads && this.idleWorkers.length > 0) {
      const worker = this.idleWorkers.pop()!;
      const timer = this.idleTimers.get(worker);
      if (timer) {
        clearTimeout(timer);
        this.idleTimers.delete(worker);
      }
      this.allWorkers.delete(worker);
      worker.terminate();
    }
  }

  // --- Worker creation ---

  private createAndReadyWorker(): void {
    const worker = this.adapter.createWorker();

    const onReady = () => {
      this.pendingWorkerCount--;
      this.allWorkers.add(worker);

      const task = this.pendingTasksForWorkers.shift();
      if (task) {
        if (task.concurrent) {
          this.dispatchConcurrent(worker, task);
        } else {
          this.dispatch(worker, task);
        }
      } else {
        this.makeIdle(worker);
      }
    };

    worker.on("message", (response) => {
      if (response.type === "ready") {
        onReady();
        return;
      }
      this.handleWorkerMessage(worker, response);
    });

    worker.on("error", (err: Error) => {
      this.rejectExclusiveTaskForWorker(worker, err);
      // Clean up concurrent tasks on this worker
      const taskSet = this.sharedWorkers.get(worker);
      if (taskSet) {
        for (const taskId of taskSet) {
          this.rejectTask(taskId, err);
        }
        this.sharedWorkers.delete(worker);
      }
    });

    worker.on("exit", (_code: number) => {
      this.allWorkers.delete(worker);
      this.workerFunctionIds.delete(worker);
      const timer = this.idleTimers.get(worker);
      if (timer) {
        clearTimeout(timer);
        this.idleTimers.delete(worker);
      }

      // Remove from idle if present
      const idleIdx = this.idleWorkers.indexOf(worker);
      if (idleIdx !== -1) {
        this.idleWorkers.splice(idleIdx, 1);
      }

      this.rejectExclusiveTaskForWorker(worker, new Error("Worker exited unexpectedly"));

      // Redistribute deque tasks back to the global queue so other workers can pick them up
      this.flushDeque(worker);

      // Clean up concurrent tasks
      const taskSet = this.sharedWorkers.get(worker);
      if (taskSet) {
        for (const taskId of taskSet) {
          this.rejectTask(taskId, new Error("Worker exited unexpectedly"));
        }
        this.sharedWorkers.delete(worker);
      }
    });
  }

  // --- Stats ---

  stats(): PoolStats {
    let concurrentTasks = 0;
    for (const taskSet of this.sharedWorkers.values()) {
      concurrentTasks += taskSet.size;
    }

    // Include per-worker deque sizes in queued task counts
    let dequeHigh = 0;
    let dequeNormal = 0;
    let dequeLow = 0;
    for (const deque of this.workerDeques.values()) {
      dequeHigh += deque.high.length;
      dequeNormal += deque.normal.length;
      dequeLow += deque.low.length;
    }

    const queuedHigh = this.queues.high.length + dequeHigh;
    const queuedNormal = this.queues.normal.length + dequeNormal;
    const queuedLow = this.queues.low.length + dequeLow;

    return {
      totalWorkers: this.allWorkers.size,
      idleWorkers: this.idleWorkers.length,
      busyWorkers: this.exclusiveWorkers.size,
      sharedWorkers: this.sharedWorkers.size,
      concurrentTasks,
      pendingWorkers: this.pendingWorkerCount,
      queuedTasks: {
        high: queuedHigh,
        normal: queuedNormal,
        low: queuedLow,
        total: queuedHigh + queuedNormal + queuedLow,
      },
      queuedConcurrentTasks: {
        high: this.concurrentQueues.high.length,
        normal: this.concurrentQueues.normal.length,
        low: this.concurrentQueues.low.length,
        total:
          this.concurrentQueues.high.length +
          this.concurrentQueues.normal.length +
          this.concurrentQueues.low.length,
      },
      totalCompleted: this.totalCompleted,
      totalFailed: this.totalFailed,
      maxThreads: this.config.maxThreads,
      concurrency: this.config.concurrency,
    };
  }
}

export interface PoolStats {
  totalWorkers: number;
  idleWorkers: number;
  busyWorkers: number;
  sharedWorkers: number;
  concurrentTasks: number;
  pendingWorkers: number;
  queuedTasks: {
    high: number;
    normal: number;
    low: number;
    total: number;
  };
  queuedConcurrentTasks: {
    high: number;
    normal: number;
    low: number;
    total: number;
  };
  totalCompleted: number;
  totalFailed: number;
  maxThreads: number;
  concurrency: number;
}

// Pool singleton
let poolInstance: WorkerPool | null = null;

function createAdapter(adapterConfig: string): WorkerAdapter {
  if (adapterConfig === "inline") return new InlineAdapter();
  if (adapterConfig === "node") return new NodeWorkerAdapter();
  if (adapterConfig === "bun") return new BunWorkerAdapter();

  // auto — detect runtime
  const capability = detectCapability();
  if (capability === "single-thread") {
    throw new Error(
      "puru requires a runtime with thread support (Node.js or Bun). " +
        "Current runtime does not support worker threads.",
    );
  }
  const runtime = detectRuntime();
  if (runtime === "bun") return new BunWorkerAdapter();
  return new NodeWorkerAdapter();
}

export function getPool(): WorkerPool {
  if (!poolInstance) {
    const config = getConfig();
    poolInstance = new WorkerPool(config, createAdapter(config.adapter));
  }
  return poolInstance;
}

export function stats(): PoolStats {
  return getPool().stats();
}

export function resize(maxThreads: number): void {
  getPool().resize(maxThreads);
}

/**
 * Gracefully shut down the thread pool.
 *
 * Rejects all queued tasks, waits for all workers to terminate, then clears
 * the pool. Safe to call at process exit or at the end of a test suite.
 *
 * ```ts
 * process.on('SIGTERM', async () => {
 *   await shutdown()
 *   process.exit(0)
 * })
 * ```
 */
export async function shutdown(): Promise<void> {
  if (poolInstance) {
    await poolInstance.drain();
    poolInstance = null;
  }
}

/** @internal For testing only */
export async function resetPool(): Promise<void> {
  await shutdown();
}
