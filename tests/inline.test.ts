import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorkerPool } from '../src/pool.js'
import { InlineAdapter } from '../src/adapters/inline.js'

describe('InlineAdapter', () => {
  let pool: WorkerPool

  beforeEach(() => {
    pool = new WorkerPool(
      { maxThreads: 2, strategy: 'fifo', idleTimeout: 500, adapter: 'inline' },
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
})

function createTask(id: string, fnStr: string) {
  let resolve!: (value: unknown) => void
  let reject!: (reason: unknown) => void
  const result = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  const task = { id, fnStr, resolve, reject, priority: 'normal' as const }
  return { task, result, promise: { task, result } }
}
