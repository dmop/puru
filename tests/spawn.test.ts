import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn, resetTaskCounter } from '../src/spawn.js'
import { resetPool } from '../src/pool.js'
import { resetConfig, configure } from '../src/configure.js'
import { background, withCancel, withTimeout } from '../src/context.js'

describe('spawn', () => {
  beforeEach(() => {
    resetConfig()
    configure({ maxThreads: 4, idleTimeout: 1000 })
  })

  afterEach(async () => {
    await resetPool()
    resetTaskCounter()
  })

  it('runs a sync arrow function', async () => {
    const { result } = spawn(() => 42)
    expect(await result).toBe(42)
  })

  it('runs an async arrow function', async () => {
    const { result } = spawn(async () => {
      return 42
    })
    expect(await result).toBe(42)
  })

  it('runs a regular function', async () => {
    const { result } = spawn(function () {
      return 'hello'
    })
    expect(await result).toBe('hello')
  })

  it('runs CPU-bound work', async () => {
    const { result } = spawn(() => {
      let sum = 0
      for (let i = 0; i < 1_000_000; i++) sum += i
      return sum
    })
    expect(await result).toBe(499999500000)
  })

  it('rejects when the function throws', async () => {
    const { result } = spawn(() => {
      throw new Error('boom')
    })
    await expect(result).rejects.toThrow('boom')
  })

  it('runs multiple spawns concurrently', async () => {
    const handles = Array.from({ length: 4 }, () =>
      spawn(() => {
        let sum = 0
        for (let j = 0; j < 100_000; j++) sum += j
        return sum
      }),
    )
    const results = await Promise.all(handles.map((h) => h.result))
    expect(results).toEqual(Array(4).fill(4999950000))
  })

  it('cancels a queued task', async () => {
    // Use 1 thread and queue a task behind a slow one
    resetConfig()
    configure({ maxThreads: 1, idleTimeout: 1000 })

    const slow = spawn(() => {
      let s = 0
      for (let i = 0; i < 50_000_000; i++) s += i
      return s
    })

    const fast = spawn(() => 99)
    fast.cancel()

    await expect(fast.result).rejects.toThrow('Task was cancelled')
    // slow should still resolve
    await slow.result
  })

  it('cancelling a running CPU task rejects the caller immediately but does not preempt computation', async () => {
    resetConfig()
    configure({ maxThreads: 1, idleTimeout: 1000 })

    const started = spawn(() => {
      const start = Date.now()
      while (Date.now() - start < 100) {
        // busy loop
      }
      return 'done'
    })

    started.cancel()

    await expect(started.result).rejects.toThrow('Task was cancelled')
  })

  it('returns structured-cloneable data', async () => {
    const { result } = spawn(() => ({
      name: 'test',
      values: [1, 2, 3],
      nested: { ok: true },
    }))
    expect(await result).toEqual({
      name: 'test',
      values: [1, 2, 3],
      nested: { ok: true },
    })
  })

  it('enriches error stack with spawn call site', async () => {
    const { result } = spawn(() => {
      throw new Error('stack test')
    })
    const err = await result.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).stack).toContain('--- spawned at ---')
  })

  it('handles non-Error throws from worker', async () => {
    const { result } = spawn(() => {
      throw 'string error'  // eslint-disable-line no-throw-literal
    })
    await expect(result).rejects.toThrow('string error')
  })

  it('returns the same result when the same function is spawned multiple times', async () => {
    const fn = () => 7
    const results = await Promise.all(
      Array.from({ length: 10 }, () => spawn(fn).result),
    )
    expect(results).toEqual(Array(10).fill(7))
  })

  it('returns undefined when function has no return', async () => {
    const { result } = spawn(() => {})
    expect(await result).toBeUndefined()
  })

  it('returns null from worker', async () => {
    const { result } = spawn(() => null)
    expect(await result).toBeNull()
  })

  it('returns 0 and empty string without confusing them with falsy', async () => {
    const { result: zeroResult } = spawn(() => 0)
    const { result: emptyResult } = spawn(() => '')
    expect(await zeroResult).toBe(0)
    expect(await emptyResult).toBe('')
  })

  it('cancelling an already-settled task is a no-op', async () => {
    const { result, cancel } = spawn(() => 42)
    expect(await result).toBe(42)
    // Should not throw
    cancel()
    cancel()
  })

  it('rejects with TypeError from worker', async () => {
    const { result } = spawn(() => {
      throw new TypeError('bad type')
    })
    await expect(result).rejects.toThrow('bad type')
  })

  it('rejects with RangeError from worker', async () => {
    const { result } = spawn(() => {
      throw new RangeError('out of range')
    })
    await expect(result).rejects.toThrow('out of range')
  })

  it('rejects when async function rejects a promise', async () => {
    const { result } = spawn(async () => {
      return Promise.reject(new Error('async rejection'))
    })
    await expect(result).rejects.toThrow('async rejection')
  })

  it('rejects on syntax error in function body', async () => {
    // Use new Function to craft a function whose body has a runtime error
    const { result } = spawn(() => {
      // @ts-expect-error intentional runtime error
      return undeclaredVariable  // eslint-disable-line no-undef
    })
    await expect(result).rejects.toThrow('undeclaredVariable')
  })

  it('cancel before task starts still rejects with cancellation', async () => {
    resetConfig()
    configure({ maxThreads: 1, idleTimeout: 1000 })

    // Block the worker
    const blocker = spawn(() => {
      let s = 0
      for (let i = 0; i < 50_000_000; i++) s += i
      return s
    })

    // Queue and immediately cancel
    const queued = spawn(() => 'never')
    queued.cancel()
    await expect(queued.result).rejects.toThrow('Task was cancelled')

    await blocker.result
  })

  it('error in one spawn does not break subsequent spawns', async () => {
    const { result: bad } = spawn(() => { throw new Error('first') })
    await expect(bad).rejects.toThrow('first')

    const { result: good } = spawn(() => 'recovered')
    expect(await good).toBe('recovered')
  })

  it('multiple spawns can fail independently', async () => {
    const results = await Promise.allSettled([
      spawn(() => { throw new Error('err1') }).result,
      spawn(() => 'ok').result,
      spawn(() => { throw new Error('err3') }).result,
    ])
    expect(results[0].status).toBe('rejected')
    expect(results[1]).toEqual({ status: 'fulfilled', value: 'ok' })
    expect(results[2].status).toBe('rejected')
  })

  describe('context integration', () => {
    it('rejects immediately if context is already cancelled', async () => {
      const [ctx, cancel] = withCancel(background())
      cancel()
      const { result } = spawn(() => 42, { ctx })
      await expect(result).rejects.toThrow('context cancelled')
    })

    it('cancels a running task when context is cancelled', async () => {
      const [ctx, cancel] = withCancel(background())
      const { result } = spawn(() => {
        const start = Date.now()
        while (Date.now() - start < 5000) { /* busy */ }
        return 'done'
      }, { ctx })

      cancel()
      await expect(result).rejects.toThrow('Task was cancelled')
    })

    it('does not interfere when task completes before context cancellation', async () => {
      const [ctx] = withCancel(background())
      const { result } = spawn(() => 42, { ctx })
      expect(await result).toBe(42)
    })

    it('cancels with withTimeout', async () => {
      const [ctx] = withTimeout(background(), 50)
      const { result } = spawn(() => {
        const start = Date.now()
        while (Date.now() - start < 5000) { /* busy */ }
        return 'done'
      }, { ctx })

      await expect(result).rejects.toThrow('Task was cancelled')
    })

    it('cancel + context cancel does not double-reject', async () => {
      const [ctx, ctxCancel] = withCancel(background())
      const handle = spawn(() => {
        const start = Date.now()
        while (Date.now() - start < 5000) { /* busy */ }
        return 'done'
      }, { ctx })

      // Cancel both ways simultaneously
      handle.cancel()
      ctxCancel()

      await expect(handle.result).rejects.toThrow('Task was cancelled')
    })

    it('withTimeout of 0 rejects immediately', async () => {
      const [ctx] = withTimeout(background(), 0)
      const { result } = spawn(() => 42, { ctx })
      await expect(result).rejects.toThrow('cancelled')
    })
  })
})
