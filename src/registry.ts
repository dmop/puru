import { getPool } from './pool.js'
import { serializeFunction } from './serialize.js'
import type { JsonValue, StructuredCloneValue, Task, TaskError } from './types.js'

let taskCounter = 0

/**
 * Define a reusable task that runs in a worker thread.
 *
 * Returns a typed async function — call it like a regular async function,
 * and it dispatches to the thread pool each time.
 *
 * Use task() when you have the same function to call many times with
 * different arguments. For one-off work, use spawn() instead.
 *
 * Arguments must be JSON-serializable (no functions, symbols, undefined, or BigInt).
 * The function itself must be self-contained — it cannot capture enclosing scope variables.
 *
 * @example
 * const resizeImage = task((src: string, width: number, height: number) => {
 *   // runs in a worker thread
 *   return processPixels(src, width, height)
 * })
 *
 * const result = await resizeImage('photo.jpg', 800, 600)
 * const [a, b] = await Promise.all([resizeImage('a.jpg', 400, 300), resizeImage('b.jpg', 800, 600)])
 */
export function task<TArgs extends JsonValue[], TReturn extends StructuredCloneValue>(
  fn: (...args: TArgs) => TReturn | Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  return (...args: TArgs): Promise<TReturn> => {
    const fnStr = serializeFunction(fn)
    const serializedArgs = args.map((a) => {
      const json = JSON.stringify(a)
      if (json === undefined) {
        throw new TypeError(
          `Argument of type ${typeof a} is not JSON-serializable. ` +
            'task() args must be JSON-serializable (no undefined, functions, symbols, or BigInt).',
        )
      }
      return json
    })
    const wrapperStr = `() => (${fnStr})(${serializedArgs.join(', ')})`

    const taskId = `task_${++taskCounter}`
    const spawnStack = new Error().stack

    let resolveFn!: (value: TReturn) => void
    let rejectFn!: (reason: TaskError) => void

    const result = new Promise<TReturn>((resolve, reject) => {
      resolveFn = resolve
      rejectFn = reject
    })

    const taskObj: Task = {
      id: taskId,
      fnStr: wrapperStr,
      priority: 'normal',
      concurrent: false,
      resolve: (value) => resolveFn(value as TReturn),
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

    getPool().submit(taskObj)

    return result
  }
}

/** @internal For testing only */
export function resetTaskCounter(): void {
  taskCounter = 0
}
