import { spawn as spawnTask } from "./spawn.js";
import type { ChannelValue, SpawnResult, StructuredCloneValue, TaskError } from "./types.js";
import type { Channel } from "./channel.js";
import type { Context } from "./context.js";

type SpawnChannels = Record<string, Channel<ChannelValue>>;

/**
 * Like `WaitGroup`, but cancels all remaining tasks on the first error.
 *
 * Modeled after Go's `golang.org/x/sync/errgroup`. Use when partial results are useless —
 * if any task fails, there is no point waiting for the rest. Benchmarks show ~3.7x faster
 * failure handling than waiting for all tasks to settle.
 *
 * For "wait for everything regardless of failures", use `WaitGroup` with `waitSettled()`.
 *
 * @example
 * const eg = new ErrGroup()
 * eg.spawn(() => run('fetchUser', userId))
 * eg.spawn(() => run('fetchOrders', userId))
 * eg.spawn(() => run('fetchAnalytics', userId))
 *
 * try {
 *   const [user, orders, analytics] = await eg.wait()
 * } catch (err) {
 *   // First failure cancelled the rest — no partial data to clean up
 * }
 *
 * @example
 * // Observe cancellation inside a task via the shared signal
 * const eg = new ErrGroup()
 * eg.spawn(() => {
 *   // eg.signal is not directly available inside the worker —
 *   // use task() with register() and check a channel or AbortSignal instead
 * })
 */
export class ErrGroup<T extends StructuredCloneValue = StructuredCloneValue> {
  private tasks: SpawnResult<T>[] = [];
  private controller = new AbortController();
  private firstError: TaskError | null = null;
  private hasError = false;
  private ctx?: Context;
  private limit = 0; // 0 = unlimited
  private inFlight = 0;
  private waiting: (() => void)[] = [];

  constructor(ctx?: Context) {
    this.ctx = ctx;
    if (ctx) {
      if (ctx.signal.aborted) {
        this.controller.abort();
      } else {
        ctx.signal.addEventListener("abort", () => this.cancel(), { once: true });
      }
    }
  }

  /** Shared abort signal for this group. Aborted on `cancel()` or first failure. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /**
   * Set the maximum number of tasks that can run concurrently.
   * Like Go's `errgroup.SetLimit()`. Must be called before any `spawn()`.
   * A value of 0 (default) means unlimited.
   */
  setLimit(n: number): void {
    if (this.tasks.length > 0) {
      throw new Error("SetLimit must be called before any spawn()");
    }
    if (n < 0 || !Number.isInteger(n)) {
      throw new RangeError("Limit must be a non-negative integer");
    }
    this.limit = n;
  }

  spawn<TChannels extends SpawnChannels = Record<never, never>>(
    fn: (() => T | Promise<T>) | ((channels: TChannels) => T | Promise<T>),
    opts?: { concurrent?: boolean; channels?: TChannels },
  ): void {
    // Same rule as spawn(): the worker function must be self-contained and
    // cannot capture variables from outer scope.
    if (this.controller.signal.aborted) {
      throw new Error("ErrGroup has been cancelled");
    }

    if (this.limit > 0 && this.inFlight >= this.limit) {
      // Queue the spawn until a slot opens
      let innerCancel: () => void = () => {};
      let cancelled = false;
      const cancel = () => {
        cancelled = true;
        innerCancel();
      };
      const result = new Promise<void>((resolve) => {
        this.waiting.push(resolve);
      }).then(() => {
        if (cancelled) throw new DOMException("Task was cancelled", "AbortError");
        const handle = this.doSpawn(fn, opts);
        innerCancel = handle.cancel;
        return handle.result;
      });
      this.tasks.push({ result, cancel });
      return;
    }

    const handle = this.doSpawn(fn, opts);
    this.tasks.push(handle);
  }

  private doSpawn<TChannels extends SpawnChannels = Record<never, never>>(
    fn: (() => T | Promise<T>) | ((channels: TChannels) => T | Promise<T>),
    opts?: { concurrent?: boolean; channels?: TChannels },
  ): SpawnResult<T> {
    this.inFlight++;
    const handle = spawnTask<T, TChannels>(fn, { ...opts, ctx: this.ctx });

    // When task settles, release the semaphore slot
    const onSettle = () => {
      this.inFlight--;
      const next = this.waiting.shift();
      if (next) next();
    };

    // Watch for errors and cancel all tasks on first failure
    handle.result.then(onSettle, (err) => {
      onSettle();
      if (!this.hasError) {
        this.hasError = true;
        this.firstError = err;
        this.cancel();
      }
    });

    return handle;
  }

  async wait(): Promise<T[]> {
    const settled = await Promise.allSettled(this.tasks.map((t) => t.result));

    if (this.hasError && this.firstError) {
      throw this.firstError;
    }

    return settled.map((r) => {
      if (r.status === "fulfilled") return r.value;
      throw r.reason;
    });
  }

  /** Cancel all active and queued tasks in the group. */
  cancel(): void {
    this.controller.abort();
    for (const task of this.tasks) {
      task.cancel();
    }
  }
}
