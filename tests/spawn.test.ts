import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn, resetTaskCounter } from '../src/spawn.js'
import { resetPool } from '../src/pool.js'
import { resetConfig, configure } from '../src/configure.js'

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
    const handles = Array.from({ length: 4 }, (_, i) =>
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

    await expect(fast.result).rejects.toThrow()
    // slow should still resolve
    await slow.result
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
})
