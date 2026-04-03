import { spawn } from './spawn.js'
import type { SpawnResult } from './types.js'
import type { Channel } from './channel.js'

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
