import { getPool } from './pool.js'
import { serializeFunction } from './serialize.js'
import type { SpawnResult, Task } from './types.js'

type TaskFn = (...args: unknown[]) => unknown

const registry = new Map<string, TaskFn>()
let taskCounter = 0

export function register(name: string, fn: TaskFn): void {
  if (registry.has(name)) {
    throw new Error(`Task "${name}" is already registered`)
  }
  registry.set(name, fn)
}

export function run<T = unknown>(
  name: string,
  ...args: unknown[]
): Promise<T> {
  const fn = registry.get(name)
  if (!fn) {
    throw new Error(`Task "${name}" is not registered. Call register() first.`)
  }

  // Serialize the function and JSON-encode args into a self-contained string
  // that the worker can execute without any closures.
  const fnStr = serializeFunction(fn)
  const serializedArgs = args.map((a) => {
    const json = JSON.stringify(a)
    if (json === undefined) {
      throw new TypeError(
        `Argument of type ${typeof a} is not JSON-serializable. ` +
        'run() args must be JSON-serializable (no undefined, functions, symbols, or BigInt).',
      )
    }
    return json
  })
  const wrapperStr = `() => (${fnStr})(${serializedArgs.join(', ')})`

  const taskId = `reg_${++taskCounter}`
  const spawnStack = new Error().stack

  let resolveFn!: (value: T) => void
  let rejectFn!: (reason: unknown) => void

  const result = new Promise<T>((resolve, reject) => {
    resolveFn = resolve
    rejectFn = reject
  })

  const task: Task = {
    id: taskId,
    fnStr: wrapperStr,
    priority: 'normal',
    concurrent: false,
    resolve: (value) => resolveFn(value as T),
    reject: (reason) => {
      if (reason instanceof Error && spawnStack) {
        const callerLine = spawnStack.split('\n').slice(2).join('\n')
        reason.stack =
          (reason.stack ?? reason.message) +
          '\n    --- spawned at ---\n' +
          callerLine
      }
      rejectFn(reason)
    },
  }

  getPool().submit(task)

  return result
}

/** @internal For testing only */
export function clearRegistry(): void {
  registry.clear()
  taskCounter = 0
}
