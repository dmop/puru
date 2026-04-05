import { spawn as spawnTask } from "./spawn.js";
import type { ChannelValue, SpawnResult, StructuredCloneValue } from "./types.js";
import type { Channel } from "./channel.js";
import type { Context } from "./context.js";

type SpawnChannels = Record<string, Channel<ChannelValue>>;

/**
 * Structured concurrency: spawn multiple tasks and wait for all to complete.
 *
 * Like `Promise.all`, but tasks run in worker threads across CPU cores. Results are
 * returned in the order tasks were spawned. A shared `AbortSignal` lets long-running
 * tasks observe cooperative cancellation via `cancel()`.
 *
 * For fail-fast behavior (cancel all on first error), use `ErrGroup` instead.
 *
 * @example
 * // CPU-bound parallel work
 * const wg = new WaitGroup()
 * wg.spawn(() => { /* define helpers inside — no closure captures *\/ })
 * wg.spawn(() => { /* another CPU task *\/ })
 * const [r1, r2] = await wg.wait()
 *
 * @example
 * // Mixed CPU + I/O
 * wg.spawn(() => crunchNumbers(), )
 * wg.spawn(() => fetch('https://api.example.com').then(r => r.json()), { concurrent: true })
 * const results = await wg.wait()
 *
 * @example
 * // Tolerate partial failures with waitSettled
 * const settled = await wg.waitSettled()
 * for (const r of settled) {
 *   if (r.status === 'fulfilled') use(r.value)
 *   else console.error(r.reason)
 * }
 */
export class WaitGroup<T extends StructuredCloneValue = StructuredCloneValue> {
  private tasks: SpawnResult<T>[] = [];
  private controller = new AbortController();
  private ctx?: Context;

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

  /**
   * An `AbortSignal` shared across all tasks in this group.
   * Pass it into spawned functions so they can stop early when `cancel()` is called.
   */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /**
   * Spawns a function on a worker thread and adds it to the group.
   *
   * The function follows the same rule as `spawn()`: it must be self-contained
   * and cannot capture variables from outer scope.
   *
   * @throws If the group has already been cancelled.
   */
  spawn<TChannels extends SpawnChannels = Record<never, never>>(
    fn: (() => T | Promise<T>) | ((channels: TChannels) => T | Promise<T>),
    opts?: { concurrent?: boolean; channels?: TChannels },
  ): void {
    if (this.controller.signal.aborted) {
      throw new Error("WaitGroup has been cancelled");
    }
    const handle = spawnTask<T, TChannels>(fn, { ...opts, ctx: this.ctx });
    this.tasks.push(handle);
  }

  /**
   * Waits for all tasks to complete successfully.
   * Rejects as soon as any task throws.
   */
  async wait(): Promise<T[]> {
    return Promise.all(this.tasks.map((t) => t.result));
  }

  /**
   * Waits for all tasks to settle (fulfilled or rejected) and returns each outcome.
   * Never rejects — inspect each `PromiseSettledResult` to handle failures individually.
   */
  async waitSettled(): Promise<PromiseSettledResult<T>[]> {
    return Promise.allSettled(this.tasks.map((t) => t.result));
  }

  /**
   * Cancels all tasks in the group and signals the shared `AbortSignal`.
   * Already-settled tasks are unaffected.
   */
  cancel(): void {
    this.controller.abort();
    for (const task of this.tasks) {
      task.cancel();
    }
  }
}
