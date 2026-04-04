import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorkerPool } from '../src/pool.js'
import { InlineAdapter } from '../src/adapters/inline.js'
import type { StructuredCloneValue, Task, TaskError } from '../src/types.js'

const fnIds = new Map<string, string>()

describe('InlineAdapter', () => {
  let pool: WorkerPool

  beforeEach(() => {
    pool = new WorkerPool(
      { maxThreads: 2, strategy: 'fifo', idleTimeout: 500, adapter: 'inline', concurrency: 64 },
      new InlineAdapter(),
    )
  })

  afterEach(async () => {
    await pool.drain()
  })

  it('executes a task inline', async () => {
    const { promise } = createTask('1', '() => 42')
    pool.submit(promise.task)
    expect(await promise.result).toBe(42)
  })

  it('handles errors', async () => {
    const { promise } = createTask('2', '() => { throw new Error("inline fail") }')
    pool.submit(promise.task)
    await expect(promise.result).rejects.toThrow('inline fail')
  })

  it('runs multiple tasks', async () => {
    const t1 = createTask('1', '() => "a"')
    const t2 = createTask('2', '() => "b"')
    pool.submit(t1.task)
    pool.submit(t2.task)
    expect(await t1.result).toBe('a')
    expect(await t2.result).toBe('b')
  })

  it('runs async functions', async () => {
    const { promise } = createTask('3', 'async () => { return 99 }')
    pool.submit(promise.task)
    expect(await promise.result).toBe(99)
  })

  it('returns correct results when same fnStr is executed multiple times (fn cache)', async () => {
    const fnStr = '() => 77'
    const t1 = createTask('c1', fnStr)
    const t2 = createTask('c2', fnStr)
    const t3 = createTask('c3', fnStr)
    pool.submit(t1.task)
    pool.submit(t2.task)
    pool.submit(t3.task)
    expect(await t1.result).toBe(77)
    expect(await t2.result).toBe(77)
    expect(await t3.result).toBe(77)
  })

  it('reuses a registered function by fnId without resending fnStr', async () => {
    const first = createTask('reuse-1', '() => 123')
    const second = createTask('reuse-2', '() => 123', undefined, false)

    pool.submit(first.task)
    expect(await first.result).toBe(123)

    pool.submit(second.task)
    expect(await second.result).toBe(123)
  })

  it('executes a task with args', async () => {
    const { promise } = createTask('a1', '(a, b) => a + b', [10, 20])
    pool.submit(promise.task)
    expect(await promise.result).toBe(30)
  })

  it('executes a task with null arg', async () => {
    const { promise } = createTask('a2', '(x) => x === null', [null])
    pool.submit(promise.task)
    expect(await promise.result).toBe(true)
  })

  it('executes a task with empty args array', async () => {
    const { promise } = createTask('a3', '() => "no-args"', [])
    pool.submit(promise.task)
    expect(await promise.result).toBe('no-args')
  })

  it('executes a task with nested object args', async () => {
    const { promise } = createTask('a4', '(obj) => obj.a.b', [{ a: { b: 42 } }])
    pool.submit(promise.task)
    expect(await promise.result).toBe(42)
  })

  it('returns undefined when function has no return', async () => {
    const { promise } = createTask('u1', '() => {}')
    pool.submit(promise.task)
    expect(await promise.result).toBeUndefined()
  })

  it('returns null from worker function', async () => {
    const { promise } = createTask('n1', '() => null')
    pool.submit(promise.task)
    expect(await promise.result).toBeNull()
  })

  it('handles error from function with args', async () => {
    const { promise } = createTask('e1', '(x) => { throw new Error("arg fail: " + x) }', ['boom'])
    pool.submit(promise.task)
    await expect(promise.result).rejects.toThrow('arg fail: boom')
  })

  it('handles non-Error throw', async () => {
    const { promise } = createTask('e2', '() => { throw "raw string" }')
    pool.submit(promise.task)
    await expect(promise.result).rejects.toThrow('raw string')
  })

  it('handles syntax error in fnStr', async () => {
    const { promise } = createTask('s1', '() => { if ( }')
    pool.submit(promise.task)
    await expect(promise.result).rejects.toThrow('Unexpected')
  })

  it('handles TypeError from function', async () => {
    const { promise } = createTask('t1', '() => { null.foo }')
    pool.submit(promise.task)
    await expect(promise.result).rejects.toThrow('null')
  })

  it('handles async rejection', async () => {
    const { promise } = createTask('ar1', 'async () => { throw new Error("async inline fail") }')
    pool.submit(promise.task)
    await expect(promise.result).rejects.toThrow('async inline fail')
  })

  it('recovers after error — fn cache does not cache broken functions', async () => {
    const { promise: bad } = createTask('r1', '() => { throw new Error("break") }')
    pool.submit(bad.task)
    await expect(bad.result).rejects.toThrow('break')

    const { promise: good } = createTask('r2', '() => "recovered"')
    pool.submit(good.task)
    expect(await good.result).toBe('recovered')
  })

  it('fn cache returns correct result for different fnStr values', async () => {
    const t1 = createTask('d1', '() => "aaa"')
    const t2 = createTask('d2', '() => "bbb"')
    pool.submit(t1.task)
    pool.submit(t2.task)
    expect(await t1.result).toBe('aaa')
    expect(await t2.result).toBe('bbb')
  })
})

function createTask(
  id: string,
  fnStr: string,
  args?: import('../src/types.js').JsonValue[],
  includeFnStr = true,
) {
  let resolve!: (value: StructuredCloneValue) => void
  let reject!: (reason: TaskError) => void
  const result = new Promise<StructuredCloneValue>((res, rej) => {
    resolve = res
    reject = rej
  })
  let fnId = fnIds.get(fnStr)
  if (!fnId) {
    fnId = `fn_${fnIds.size + 1}`
    fnIds.set(fnStr, fnId)
  }
  const task: Task = {
    id,
    fnId,
    fnStr: includeFnStr ? fnStr : '',
    args,
    resolve,
    reject,
    priority: 'normal',
    concurrent: false,
  }
  return { task, result, promise: { task, result } }
}
