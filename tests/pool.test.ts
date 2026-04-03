import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorkerPool, resetPool } from '../src/pool.js'
import { NodeWorkerAdapter } from '../src/adapters/node.js'
import { resetConfig } from '../src/configure.js'
import type { Task } from '../src/types.js'

function createTask(
  id: string,
  fnStr: string,
  priority: 'low' | 'normal' | 'high' = 'normal',
): { task: Task; promise: Promise<unknown> } {
  let resolve!: (value: unknown) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  const task: Task = { id, fnStr, resolve, reject, priority }
  return { task, promise }
}

describe('WorkerPool', () => {
  let pool: WorkerPool

  beforeEach(() => {
    pool = new WorkerPool(
      { maxThreads: 2, strategy: 'fifo', idleTimeout: 500 },
      new NodeWorkerAdapter(),
    )
  })

  afterEach(async () => {
    await pool.drain()
    resetConfig()
    await resetPool()
  })

  it('executes a simple task', async () => {
    const { task, promise } = createTask('1', '() => 42')
    pool.submit(task)
    expect(await promise).toBe(42)
  })

  it('executes multiple tasks', async () => {
    const t1 = createTask('1', '() => 1')
    const t2 = createTask('2', '() => 2')
    pool.submit(t1.task)
    pool.submit(t2.task)
    expect(await t1.promise).toBe(1)
    expect(await t2.promise).toBe(2)
  })

  it('queues tasks when all workers are busy', async () => {
    // maxThreads is 2, so 3rd task must be queued
    const t1 = createTask(
      '1',
      '() => { let s=0; for(let i=0;i<10000000;i++) s+=i; return 1 }',
    )
    const t2 = createTask(
      '2',
      '() => { let s=0; for(let i=0;i<10000000;i++) s+=i; return 2 }',
    )
    const t3 = createTask('3', '() => 3')

    pool.submit(t1.task)
    pool.submit(t2.task)
    pool.submit(t3.task)

    const results = await Promise.all([t1.promise, t2.promise, t3.promise])
    expect(results).toEqual([1, 2, 3])
  })

  it('handles task errors without killing the worker', async () => {
    const t1 = createTask('1', '() => { throw new Error("fail") }')
    pool.submit(t1.task)
    await expect(t1.promise).rejects.toThrow('fail')

    // Same pool should still work for new tasks
    const t2 = createTask('2', '() => "ok"')
    pool.submit(t2.task)
    expect(await t2.promise).toBe('ok')
  })

  it('cancels a queued task', async () => {
    const pool2 = new WorkerPool(
      { maxThreads: 1, strategy: 'fifo', idleTimeout: 500 },
      new NodeWorkerAdapter(),
    )

    const t1 = createTask(
      '1',
      '() => { let s=0; for(let i=0;i<50000000;i++) s+=i; return s }',
    )
    const t2 = createTask('2', '() => 99')

    pool2.submit(t1.task)
    pool2.submit(t2.task)
    pool2.cancelTask('2')

    await expect(t2.promise).rejects.toThrow()
    await t1.promise // should still work
    await pool2.drain()
  })

  it('dequeues high priority tasks before low', async () => {
    const pool1 = new WorkerPool(
      { maxThreads: 1, strategy: 'fifo', idleTimeout: 500 },
      new NodeWorkerAdapter(),
    )

    // Block the only worker with a slow task
    const blocker = createTask(
      'blocker',
      '() => { let s=0; for(let i=0;i<30000000;i++) s+=i; return "done" }',
    )
    pool1.submit(blocker.task)

    // Queue 3 tasks with different priorities while worker is busy
    const low = createTask('low', '() => "low"', 'low')
    const high = createTask('high', '() => "high"', 'high')
    const normal = createTask('normal', '() => "normal"', 'normal')

    pool1.submit(low.task)
    pool1.submit(high.task)
    pool1.submit(normal.task)

    // Collect the order results come back
    const order: string[] = []
    high.promise.then((v) => order.push(v as string))
    normal.promise.then((v) => order.push(v as string))
    low.promise.then((v) => order.push(v as string))

    await blocker.promise
    await Promise.all([high.promise, normal.promise, low.promise])

    // High should be dequeued first, then normal, then low
    expect(order).toEqual(['high', 'normal', 'low'])
    await pool1.drain()
  })

  it('drains all workers', async () => {
    const t1 = createTask('1', '() => 1')
    pool.submit(t1.task)
    await t1.promise
    await pool.drain()
    // After drain, new tasks should be rejected
    const t2 = createTask('2', '() => 2')
    pool.submit(t2.task)
    await expect(t2.promise).rejects.toThrow('Pool is shutting down')
  })
})
