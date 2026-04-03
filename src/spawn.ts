import { serializeFunction } from './serialize.js'
import { getPool } from './pool.js'
import type { Channel } from './channel.js'
import { getChannelId } from './channel.js'
import type { ChannelMap, ChannelValue, SpawnResult, StructuredCloneValue, Task, TaskError } from './types.js'

let taskCounter = 0

/**
 * Run a function in a worker thread. Returns a handle with the result promise and a cancel function.
 *
 * **Functions must be self-contained** — they are serialized via `.toString()` and sent to a
 * worker thread, so they cannot capture variables from the enclosing scope. Define everything
 * you need inside the function body, or use `task()` to pass arguments.
 *
 * **Two modes:**
 * - Default (exclusive): the function gets a dedicated thread. Best for CPU-bound work (> 5ms).
 * - `{ concurrent: true }`: many tasks share a thread's event loop. Best for async/I/O work.
 *
 * @example
 * // CPU-bound work — define helpers inside the function body
 * const { result } = spawn(() => {
 *   function fibonacci(n: number): number {
 *     if (n <= 1) return n
 *     return fibonacci(n - 1) + fibonacci(n - 2)
 *   }
 *   return fibonacci(40)
 * })
 * console.log(await result)
 *
 * @example
 * // I/O-bound work — concurrent mode shares threads efficiently
 * const { result } = spawn(() => fetch('https://api.example.com').then(r => r.json()), {
 *   concurrent: true,
 * })
 *
 * @example
 * // Cancel a long-running task
 * const { result, cancel } = spawn(() => longRunningTask())
 * setTimeout(cancel, 5000)
 *
 * @example
 * // Cross-thread channels — pass channels via opts.channels
 * const ch = chan<number>(10)
 * spawn(async ({ ch }) => {
 *   for (let i = 0; i < 100; i++) await ch.send(i)
 *   ch.close()
 * }, { channels: { ch } })
 */
export function spawn<T extends StructuredCloneValue, TChannels extends Record<string, Channel<ChannelValue>> = Record<never, never>>(
  fn: (() => T | Promise<T>) | ((channels: TChannels) => T | Promise<T>),
  opts?: {
    priority?: 'low' | 'normal' | 'high'
    concurrent?: boolean
    channels?: TChannels
  },
): SpawnResult<T> {
  const fnStr = serializeFunction(fn)
  const taskId = String(++taskCounter)

  // Capture the call site stack for better error reporting
  const spawnStack = new Error().stack

  let resolveFn!: (value: T) => void
  let rejectFn!: (reason: TaskError) => void
  let settled = false

  const result = new Promise<T>((resolve, reject) => {
    resolveFn = resolve
    rejectFn = reject
  })

  // Extract channel IDs if channels are provided
  let channelMap: ChannelMap | undefined
  if (opts?.channels) {
    channelMap = {}
    for (const [name, ch] of Object.entries(opts.channels)) {
      channelMap[name] = getChannelId(ch)
    }
  }

  const task: Task = {
    id: taskId,
    fnStr,
    priority: opts?.priority ?? 'normal',
    concurrent: opts?.concurrent ?? false,
    channels: channelMap,
    resolve: (value) => {
      if (!settled) {
        settled = true
        resolveFn(value as T)
      }
    },
    reject: (reason) => {
      if (!settled) {
        settled = true
        // Enrich worker errors with the spawn() call site
        if (reason instanceof Error && spawnStack) {
          const callerLine = spawnStack
            .split('\n')
            .slice(2)
            .join('\n')
          reason.stack =
            (reason.stack ?? reason.message) +
            '\n    --- spawned at ---\n' +
            callerLine
        }
        rejectFn(reason)
      }
    },
  }

  getPool().submit(task)

  const cancel = () => {
    if (settled) return
    settled = true
    getPool().cancelTask(taskId)
    rejectFn(new DOMException('Task was cancelled', 'AbortError'))
  }

  return { result, cancel }
}

/** @internal For testing only */
export function resetTaskCounter(): void {
  taskCounter = 0
}
