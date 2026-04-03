import { spawn } from './spawn.js'
import type { SpawnResult } from './types.js'
import type { Channel } from './channel.js'

export class WaitGroup {
  private tasks: SpawnResult<unknown>[] = []
  private controller = new AbortController()

  get signal(): AbortSignal {
    return this.controller.signal
  }

  spawn(
    fn: (() => unknown) | ((channels: Record<string, Channel<unknown>>) => unknown),
    opts?: { concurrent?: boolean; channels?: Record<string, Channel<unknown>> },
  ): void {
    if (this.controller.signal.aborted) {
      throw new Error('WaitGroup has been cancelled')
    }
    const handle = spawn(fn, opts)
    this.tasks.push(handle)
  }

  async wait(): Promise<unknown[]> {
    return Promise.all(this.tasks.map((t) => t.result))
  }

  async waitSettled(): Promise<PromiseSettledResult<unknown>[]> {
    return Promise.allSettled(this.tasks.map((t) => t.result))
  }

  cancel(): void {
    this.controller.abort()
    for (const task of this.tasks) {
      task.cancel()
    }
  }
}
