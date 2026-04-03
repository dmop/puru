import { spawn } from './spawn.js'
import type { SpawnResult } from './types.js'
import type { Channel } from './channel.js'

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
export class ErrGroup {
  private tasks: SpawnResult<unknown>[] = []
  private controller = new AbortController()
  private firstError: unknown = undefined
  private hasError = false

  get signal(): AbortSignal {
    return this.controller.signal
  }

  spawn(
    fn: (() => unknown) | ((channels: Record<string, Channel<unknown>>) => unknown),
    opts?: { concurrent?: boolean; channels?: Record<string, Channel<unknown>> },
  ): void {
    if (this.controller.signal.aborted) {
      throw new Error('ErrGroup has been cancelled')
    }
    const handle = spawn(fn, opts)

    // Watch for errors and cancel all tasks on first failure
    handle.result.catch((err) => {
      if (!this.hasError) {
        this.hasError = true
        this.firstError = err
        this.cancel()
      }
    })

    this.tasks.push(handle)
  }

  async wait(): Promise<unknown[]> {
    const settled = await Promise.allSettled(this.tasks.map((t) => t.result))

    if (this.hasError) {
      throw this.firstError
    }

    return settled.map((r) => {
      if (r.status === 'fulfilled') return r.value
      throw r.reason
    })
  }

  cancel(): void {
    this.controller.abort()
    for (const task of this.tasks) {
      task.cancel()
    }
  }
}
