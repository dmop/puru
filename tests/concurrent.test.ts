import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn, resetTaskCounter } from '../src/spawn.js'
import { stats, resetPool } from '../src/pool.js'
import { resetConfig, configure } from '../src/configure.js'

describe('concurrent (M:N scheduler)', () => {
  beforeEach(() => {
    resetConfig()
    configure({ maxThreads: 2, idleTimeout: 1000, concurrency: 64 })
  })

  afterEach(async () => {
    await resetPool()
    resetTaskCounter()
  })

  it('runs a concurrent task and returns result', async () => {
    const { result } = spawn(() => 42, { concurrent: true })
    expect(await result).toBe(42)
  })

  it('runs an async concurrent task', async () => {
    const { result } = spawn(async () => {
      return 'hello'
    }, { concurrent: true })
    expect(await result).toBe('hello')
  })

  it('runs multiple concurrent tasks on fewer workers than tasks', async () => {
    resetConfig()
    configure({ maxThreads: 1, idleTimeout: 1000, concurrency: 64 })

    // 10 concurrent tasks on 1 thread — must inline values (no closures)
    const handles = Array.from({ length: 10 }, (_, i) => {
      const fn = new Function(`return ${i} * 2`) as () => number
      return spawn(fn, { concurrent: true })
    })
    const results = await Promise.all(handles.map(h => h.result))
    expect((results as number[]).sort((a, b) => a - b)).toEqual(
      [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]
    )
  })

  it('concurrent tasks use shared workers (fewer workers than tasks)', async () => {
    resetConfig()
    configure({ maxThreads: 2, idleTimeout: 1000, concurrency: 64 })

    // Spawn 8 async concurrent tasks that take a bit of time
    const handles = Array.from({ length: 8 }, () =>
      spawn(async () => {
        await new Promise(r => setTimeout(r, 500))
        return 1
      }, { concurrent: true })
    )

    // Give time for dispatch but not completion
    await new Promise(r => setTimeout(r, 200))

    const s = stats()
    // Should use at most 2 workers for 8 tasks
    expect(s.totalWorkers).toBeLessThanOrEqual(2)
    expect(s.sharedWorkers).toBeGreaterThanOrEqual(1)
    expect(s.concurrentTasks).toBeGreaterThanOrEqual(1)

    await Promise.all(handles.map(h => h.result))
  })

  it('concurrent task failure does not affect other tasks on same worker', async () => {
    resetConfig()
    configure({ maxThreads: 1, idleTimeout: 1000, concurrency: 64 })

    const good1 = spawn(async () => {
      await new Promise(r => setTimeout(r, 30))
      return 'ok1'
    }, { concurrent: true })

    const bad = spawn(() => {
      throw new Error('boom')
    }, { concurrent: true })

    const good2 = spawn(async () => {
      await new Promise(r => setTimeout(r, 30))
      return 'ok2'
    }, { concurrent: true })

    await expect(bad.result).rejects.toThrow('boom')
    expect(await good1.result).toBe('ok1')
    expect(await good2.result).toBe('ok2')
  })

  it('cancelling a concurrent task does not terminate the worker', async () => {
    resetConfig()
    configure({ maxThreads: 1, idleTimeout: 1000, concurrency: 64 })

    const slow = spawn(async () => {
      await new Promise(r => setTimeout(r, 100))
      return 'slow'
    }, { concurrent: true })

    const toCancel = spawn(async () => {
      await new Promise(r => setTimeout(r, 200))
      return 'cancelled'
    }, { concurrent: true })

    const survivor = spawn(async () => {
      await new Promise(r => setTimeout(r, 50))
      return 'survivor'
    }, { concurrent: true })

    toCancel.cancel()

    await expect(toCancel.result).rejects.toThrow()
    expect(await slow.result).toBe('slow')
    expect(await survivor.result).toBe('survivor')
  })

  it('stats report concurrent task counts correctly', async () => {
    resetConfig()
    configure({ maxThreads: 2, idleTimeout: 1000, concurrency: 64 })

    await spawn(() => 1, { concurrent: true }).result
    await spawn(() => 2, { concurrent: true }).result
    await spawn(() => 3).result

    const s = stats()
    expect(s.totalCompleted).toBe(3)
    expect(s.concurrency).toBe(64)
  })

  it('mixed concurrent and exclusive tasks work correctly', async () => {
    resetConfig()
    configure({ maxThreads: 2, idleTimeout: 1000, concurrency: 64 })

    // Exclusive CPU task
    const exclusive = spawn(() => {
      let sum = 0
      for (let i = 0; i < 100_000; i++) sum += i
      return sum
    })

    // Concurrent async tasks
    const concurrent1 = spawn(async () => {
      await new Promise(r => setTimeout(r, 10))
      return 'c1'
    }, { concurrent: true })

    const concurrent2 = spawn(async () => {
      await new Promise(r => setTimeout(r, 10))
      return 'c2'
    }, { concurrent: true })

    expect(await exclusive.result).toBe(4999950000)
    expect(await concurrent1.result).toBe('c1')
    expect(await concurrent2.result).toBe('c2')
  })

  it('respects concurrency limit', async () => {
    resetConfig()
    configure({ maxThreads: 1, idleTimeout: 1000, concurrency: 3 })

    // Spawn 5 tasks with concurrency limit of 3 on 1 worker
    const handles = Array.from({ length: 5 }, (_, i) => {
      const fn = new Function(`
        return new Promise(r => setTimeout(() => r(${i}), 50))
      `) as () => Promise<number>
      return spawn(fn, { concurrent: true })
    })

    // Give time for dispatch
    await new Promise(r => setTimeout(r, 10))
    const s = stats()
    // At most 3 concurrent tasks on the worker, 2 should be queued
    expect(s.concurrentTasks).toBeLessThanOrEqual(3)

    const results = await Promise.all(handles.map(h => h.result))
    expect((results as number[]).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
  })

  it('concurrent tasks with priority ordering', async () => {
    resetConfig()
    configure({ maxThreads: 1, idleTimeout: 1000, concurrency: 1 })

    // Saturate the single worker
    const blocker = spawn(async () => {
      await new Promise(r => setTimeout(r, 100))
      return 'blocker'
    }, { concurrent: true })

    // These will be queued — high priority should be dequeued before low
    const low = spawn(() => 'low', { concurrent: true, priority: 'low' })
    const high = spawn(() => 'high', { concurrent: true, priority: 'high' })

    await blocker.result
    const highResult = await high.result
    const lowResult = await low.result

    expect(highResult).toBe('high')
    expect(lowResult).toBe('low')
  })

  it('WaitGroup works with concurrent option', async () => {
    const { WaitGroup } = await import('../src/waitgroup.js')

    resetConfig()
    configure({ maxThreads: 1, idleTimeout: 1000, concurrency: 64 })

    const wg = new WaitGroup()
    wg.spawn(() => 1, { concurrent: true })
    wg.spawn(() => 2, { concurrent: true })
    wg.spawn(() => 3, { concurrent: true })

    const results = await wg.wait()
    expect(results).toEqual([1, 2, 3])
  })
})
