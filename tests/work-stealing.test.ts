import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorkerPool, resetPool } from '../src/pool.js'
import { NodeWorkerAdapter } from '../src/adapters/node.js'
import type { ManagedWorker, WorkerAdapter } from '../src/adapters/base.js'
import { resetConfig } from '../src/configure.js'
import type { PuruConfig, StructuredCloneValue, Task, TaskError, WorkerResponse } from '../src/types.js'

const fnIds = new Map<string, string>()

function wsConfig(overrides?: Partial<PuruConfig>): PuruConfig {
  return {
    maxThreads: 2,
    strategy: 'work-stealing',
    idleTimeout: 500,
    adapter: 'node',
    concurrency: 64,
    ...overrides,
  }
}

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
  let fnId = fnIds.get(fnStr)
  if (!fnId) {
    fnId = `fn_${fnIds.size + 1}`
    fnIds.set(fnStr, fnId)
  }
  const task: Task = { id, fnId, fnStr, resolve, reject, priority, concurrent: false }
  return { task, promise }
}

describe('WorkerPool — work-stealing strategy', () => {
  let pool: WorkerPool

  beforeEach(() => {
    pool = new WorkerPool(wsConfig(), new NodeWorkerAdapter())
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

  it('executes multiple tasks across workers', async () => {
    const t1 = createTask('1', '() => 1')
    const t2 = createTask('2', '() => 2')
    pool.submit(t1.task)
    pool.submit(t2.task)
    expect(await t1.promise).toBe(1)
    expect(await t2.promise).toBe(2)
  })

  it('queues tasks to per-worker deques when all workers are busy', async () => {
    const pool1 = new WorkerPool(wsConfig({ maxThreads: 1 }), new NodeWorkerAdapter())

    const blocker = createTask(
      'blocker',
      '() => { let s=0; for(let i=0;i<10000000;i++) s+=i; return "done" }',
    )
    pool1.submit(blocker.task)

    // These should be queued in the blocker worker's deque
    const t1 = createTask('1', '() => "a"')
    const t2 = createTask('2', '() => "b"')
    pool1.submit(t1.task)
    pool1.submit(t2.task)

    await blocker.promise
    expect(await t1.promise).toBe('a')
    expect(await t2.promise).toBe('b')
    await pool1.drain()
  })

  it('steals work from a busy worker when another finishes early', async () => {
    const pool2 = new WorkerPool(wsConfig({ maxThreads: 2 }), new NodeWorkerAdapter())

    // Worker 1: slow task
    const slow = createTask(
      'slow',
      '() => { let s=0; for(let i=0;i<30000000;i++) s+=i; return "slow" }',
    )
    pool2.submit(slow.task)

    // Worker 2: fast task
    const fast = createTask('fast', '() => "fast"')
    pool2.submit(fast.task)

    // Queue 2 more tasks — they should go to per-worker deques
    const queued1 = createTask('q1', '() => "q1"')
    const queued2 = createTask('q2', '() => "q2"')
    pool2.submit(queued1.task)
    pool2.submit(queued2.task)

    // Worker 2 finishes first, should steal from Worker 1's deque
    const results = await Promise.all([
      slow.promise,
      fast.promise,
      queued1.promise,
      queued2.promise,
    ])
    expect(results).toContain('slow')
    expect(results).toContain('fast')
    expect(results).toContain('q1')
    expect(results).toContain('q2')
    await pool2.drain()
  })

  it('cancels a task from a per-worker deque', async () => {
    const pool1 = new WorkerPool(wsConfig({ maxThreads: 1 }), new NodeWorkerAdapter())

    const blocker = createTask(
      'blocker',
      '() => { let s=0; for(let i=0;i<50000000;i++) s+=i; return s }',
    )
    pool1.submit(blocker.task)

    const t1 = createTask('1', '() => 99')
    pool1.submit(t1.task)
    pool1.cancelTask('1')

    await expect(t1.promise).rejects.toThrow('Task was cancelled')
    await blocker.promise
    await pool1.drain()
  })

  it('respects priority ordering within deques', async () => {
    const pool1 = new WorkerPool(wsConfig({ maxThreads: 1 }), new NodeWorkerAdapter())

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

  it('drains rejects deque tasks', async () => {
    const pool1 = new WorkerPool(wsConfig({ maxThreads: 1 }), new NodeWorkerAdapter())

    const blocker = createTask(
      'blocker',
      '() => { let s=0; for(let i=0;i<50000000;i++) s+=i; return s }',
    )
    pool1.submit(blocker.task)

    const t1 = createTask('1', '() => "never"')
    pool1.submit(t1.task)

    await pool1.drain()
    await expect(t1.promise).rejects.toThrow('Pool is shutting down')
  })

  it('handles task errors without killing the worker', async () => {
    const t1 = createTask('1', '() => { throw new Error("fail") }')
    pool.submit(t1.task)
    await expect(t1.promise).rejects.toThrow('fail')

    const t2 = createTask('2', '() => "ok"')
    pool.submit(t2.task)
    expect(await t2.promise).toBe('ok')
  })

  it('worker recovers after errors and processes deque tasks', async () => {
    const pool1 = new WorkerPool(wsConfig({ maxThreads: 1 }), new NodeWorkerAdapter())

    // Submit a failing task
    const fail1 = createTask('f1', '() => { throw new Error("err1") }')
    pool1.submit(fail1.task)
    await expect(fail1.promise).rejects.toThrow('err1')

    // Block the worker, then queue a deque task
    const blocker = createTask(
      'blocker',
      '() => { let s=0; for(let i=0;i<10000000;i++) s+=i; return "blocked" }',
    )
    pool1.submit(blocker.task)

    const dequeTask = createTask('d1', '() => "dequeued"')
    pool1.submit(dequeTask.task)

    await blocker.promise
    expect(await dequeTask.promise).toBe('dequeued')
    await pool1.drain()
  })

  it('stats include deque sizes in queuedTasks', async () => {
    const fakeWorker = createFakeWorker()
    const pool1 = new WorkerPool(
      wsConfig({ maxThreads: 1 }),
      createFakeAdapter(fakeWorker),
    )

    // Submit a task to occupy the worker
    const t1 = createTask('1', '() => 42')
    pool1.submit(t1.task)
    fakeWorker.emitMessage({ type: 'ready' })

    // Submit more tasks — they should go to the deque
    const t2 = createTask('2', '() => 43')
    const t3 = createTask('3', '() => 44', 'high')
    pool1.submit(t2.task)
    pool1.submit(t3.task)

    // Suppress unhandled rejections from drain
    t1.promise.catch(() => {})
    t2.promise.catch(() => {})
    t3.promise.catch(() => {})

    const s = pool1.stats()
    expect(s.queuedTasks.total).toBe(2)
    expect(s.queuedTasks.high).toBe(1)
    expect(s.queuedTasks.normal).toBe(1)

    await pool1.drain()
  })

  it('redistributes deque tasks when worker exits unexpectedly', async () => {
    const fakeWorker1 = createFakeWorker()
    const fakeWorker2 = createFakeWorker()
    const workers = [fakeWorker1, fakeWorker2]
    let workerIdx = 0

    const pool2 = new WorkerPool(
      wsConfig({ maxThreads: 2 }),
      { createWorker: () => workers[workerIdx++] },
    )

    // Occupy both workers
    const t1 = createTask('1', '() => "from-w1"')
    const t2 = createTask('2', '() => "from-w2"')
    pool2.submit(t1.task)
    pool2.submit(t2.task)
    fakeWorker1.emitMessage({ type: 'ready' })
    fakeWorker2.emitMessage({ type: 'ready' })

    // Queue a deque task for worker 1
    const t3 = createTask('3', '() => "dequeued"')
    pool2.submit(t3.task)

    // Worker 1 exits unexpectedly — deque tasks should be flushed to global queue
    fakeWorker1.emitExit(1)

    // t1 should be rejected
    await expect(t1.promise).rejects.toThrow('Worker exited unexpectedly')

    // Worker 2 finishes — it should pick up t3 from the flushed global queue
    fakeWorker2.emitMessage({ type: 'result', taskId: '2', value: 'from-w2' })
    expect(await t2.promise).toBe('from-w2')

    // Worker 2 should now be executing t3 (flushed from worker 1's deque)
    fakeWorker2.emitMessage({ type: 'result', taskId: '3', value: 'dequeued' })
    expect(await t3.promise).toBe('dequeued')

    await pool2.drain()
  })

  it('stealing prefers lowest priority from victim', async () => {
    const fakeWorker1 = createFakeWorker()
    const fakeWorker2 = createFakeWorker()
    const workers = [fakeWorker1, fakeWorker2]
    let workerIdx = 0

    const pool2 = new WorkerPool(
      wsConfig({ maxThreads: 2 }),
      { createWorker: () => workers[workerIdx++] },
    )

    // Occupy both workers
    const t1 = createTask('1', '() => 1')
    const t2 = createTask('2', '() => 2')
    pool2.submit(t1.task)
    pool2.submit(t2.task)
    fakeWorker1.emitMessage({ type: 'ready' })
    fakeWorker2.emitMessage({ type: 'ready' })

    // Queue tasks to worker 1's deque with mixed priorities
    const high = createTask('high', '() => "high"', 'high')
    const low = createTask('low', '() => "low"', 'low')
    pool2.submit(high.task)
    pool2.submit(low.task)

    // Suppress unhandled rejections from drain
    t1.promise.catch(() => {})
    high.promise.catch(() => {})
    low.promise.catch(() => {})

    // Worker 2 finishes — it should steal the LOW priority task from back
    fakeWorker2.emitMessage({ type: 'result', taskId: '2', value: 2 })

    // Worker 2 should now be executing the stolen task (low priority)
    // Verify by checking the worker 1 deque still has the high task
    const s = pool2.stats()
    expect(s.queuedTasks.high).toBe(1)
    expect(s.queuedTasks.low).toBe(0)

    await pool2.drain()
  })
})

// --- Fake worker infrastructure ---

function createFakeAdapter(worker: FakeManagedWorker): WorkerAdapter {
  return {
    createWorker() {
      return worker
    },
  }
}

type MessageHandler = (data: WorkerResponse) => void
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

  emitMessage(message: WorkerResponse): void {
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
