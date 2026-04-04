import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorkerPool, resetPool } from '../src/pool.js'
import { NodeWorkerAdapter } from '../src/adapters/node.js'
import type { ManagedWorker, WorkerAdapter } from '../src/adapters/base.js'
import { resetConfig } from '../src/configure.js'
import type { StructuredCloneValue, Task, TaskError } from '../src/types.js'

function createTask(
  id: string,
  fnStr: string,
  priority: 'low' | 'normal' | 'high' = 'normal',
): { task: Task; promise: Promise<StructuredCloneValue> } {
  let resolve!: (value: StructuredCloneValue) => void
  let reject!: (reason: TaskError) => void
  const promise = new Promise<StructuredCloneValue>((res, rej) => {
    resolve = res
    reject = rej
  })
  const task: Task = { id, fnStr, resolve, reject, priority, concurrent: false }
  return { task, promise }
}

describe('WorkerPool', () => {
  let pool: WorkerPool

  beforeEach(() => {
    pool = new WorkerPool(
      { maxThreads: 2, strategy: 'fifo', idleTimeout: 500, adapter: 'node', concurrency: 64 },
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
      { maxThreads: 1, strategy: 'fifo', idleTimeout: 500, adapter: 'node', concurrency: 64 },
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

    await expect(t2.promise).rejects.toThrow('Task was cancelled')
    await t1.promise // should still work
    await pool2.drain()
  })

  it('dequeues high priority tasks before low', async () => {
    const pool1 = new WorkerPool(
      { maxThreads: 1, strategy: 'fifo', idleTimeout: 500, adapter: 'node', concurrency: 64 },
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

  it('rejects an exclusive task if the worker emits an error', async () => {
    const fakeWorker = createFakeWorker()
    const poolWithFakeWorker = new WorkerPool(
      { maxThreads: 1, strategy: 'fifo', idleTimeout: 500, adapter: 'node', concurrency: 64 },
      createFakeAdapter(fakeWorker),
    )

    const t1 = createTask('1', '() => 42')
    poolWithFakeWorker.submit(t1.task)
    fakeWorker.emitMessage({ type: 'ready' })
    fakeWorker.emitError(new Error('worker blew up'))

    await expect(t1.promise).rejects.toThrow('worker blew up')
    await poolWithFakeWorker.drain()
  })

  it('handles syntax error in fnStr', async () => {
    const t1 = createTask('syn1', '() => { if ( }')  // malformed JS
    pool.submit(t1.task)
    await expect(t1.promise).rejects.toThrow('Unexpected')
  })

  it('handles fnStr that throws TypeError', async () => {
    const t1 = createTask('te1', '() => { null.foo }')
    pool.submit(t1.task)
    await expect(t1.promise).rejects.toThrow('null')
  })

  it('handles async rejection in fnStr', async () => {
    const t1 = createTask('ar1', 'async () => { throw new Error("async boom") }')
    pool.submit(t1.task)
    await expect(t1.promise).rejects.toThrow('async boom')
  })

  it('worker recovers after multiple sequential errors', async () => {
    const pool1 = new WorkerPool(
      { maxThreads: 1, strategy: 'fifo', idleTimeout: 500, adapter: 'node', concurrency: 64 },
      new NodeWorkerAdapter(),
    )

    for (let i = 0; i < 5; i++) {
      const t = createTask(`err${i}`, '() => { throw new Error("fail") }')
      pool1.submit(t.task)
      await expect(t.promise).rejects.toThrow('fail')
    }

    // Worker should still be alive and working
    const ok = createTask('ok', '() => "alive"')
    pool1.submit(ok.task)
    expect(await ok.promise).toBe('alive')
    await pool1.drain()
  })

  it('cancel a task that is not in any queue is a no-op', async () => {
    pool.cancelTask('nonexistent-id')
    // Should not throw — just silently do nothing
    const t = createTask('1', '() => "ok"')
    pool.submit(t.task)
    expect(await t.promise).toBe('ok')
  })

  it('rejects an exclusive task if the worker exits unexpectedly', async () => {
    const fakeWorker = createFakeWorker()
    const poolWithFakeWorker = new WorkerPool(
      { maxThreads: 1, strategy: 'fifo', idleTimeout: 500, adapter: 'node', concurrency: 64 },
      createFakeAdapter(fakeWorker),
    )

    const t1 = createTask('1', '() => 42')
    poolWithFakeWorker.submit(t1.task)
    fakeWorker.emitMessage({ type: 'ready' })
    fakeWorker.emitExit(1)

    await expect(t1.promise).rejects.toThrow('Worker exited unexpectedly')
    await poolWithFakeWorker.drain()
  })
})

function createFakeAdapter(worker: FakeManagedWorker): WorkerAdapter {
  return {
    createWorker() {
      return worker
    },
  }
}

type MessageHandler = (data: import('../src/types.js').WorkerResponse) => void
type ErrorHandler = (err: Error) => void
type ExitHandler = (code: number) => void

class FakeManagedWorker implements ManagedWorker {
  readonly id = 999
  private messageHandlers: MessageHandler[] = []
  private errorHandlers: ErrorHandler[] = []
  private exitHandlers: ExitHandler[] = []

  postMessage(): void {}

  terminate(): Promise<number> {
    return Promise.resolve(0)
  }

  on(event: 'message', handler: MessageHandler): void
  on(event: 'error', handler: ErrorHandler): void
  on(event: 'exit', handler: ExitHandler): void
  on(event: 'message' | 'error' | 'exit', handler: MessageHandler | ErrorHandler | ExitHandler): void {
    if (event === 'message') this.messageHandlers.push(handler as MessageHandler)
    else if (event === 'error') this.errorHandlers.push(handler as ErrorHandler)
    else this.exitHandlers.push(handler as ExitHandler)
  }

  unref(): void {}
  ref(): void {}

  emitMessage(message: import('../src/types.js').WorkerResponse): void {
    for (const handler of this.messageHandlers) handler(message)
  }

  emitError(error: Error): void {
    for (const handler of this.errorHandlers) handler(error)
  }

  emitExit(code: number): void {
    for (const handler of this.exitHandlers) handler(code)
  }
}

function createFakeWorker(): FakeManagedWorker {
  return new FakeManagedWorker()
}
