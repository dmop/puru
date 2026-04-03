import { serializeFunction } from './serialize.js'
import { getPool } from './pool.js'
import type { SpawnResult, Task } from './types.js'
import type { Channel } from './channel.js'

let taskCounter = 0

export function spawn<T>(
  fn: (() => T | Promise<T>) | ((channels: Record<string, Channel<unknown>>) => T | Promise<T>),
  opts?: {
    priority?: 'low' | 'normal' | 'high'
    concurrent?: boolean
    channels?: Record<string, Channel<unknown>>
  },
): SpawnResult<T> {
  const fnStr = serializeFunction(fn)
  const taskId = String(++taskCounter)

  // Capture the call site stack for better error reporting
  const spawnStack = new Error().stack

  let resolveFn!: (value: T) => void
  let rejectFn!: (reason: unknown) => void
  let settled = false

  const result = new Promise<T>((resolve, reject) => {
    resolveFn = resolve
    rejectFn = reject
  })

  // Extract channel IDs if channels are provided
  let channelMap: Record<string, string> | undefined
  if (opts?.channels) {
    channelMap = {}
    for (const [name, ch] of Object.entries(opts.channels)) {
      const impl = ch as unknown as { _id: string }
      if (!impl._id) {
        throw new Error(`Channel "${name}" is not a valid puru channel`)
      }
      channelMap[name] = impl._id
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
