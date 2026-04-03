import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ErrGroup } from '../src/errgroup.js'
import { resetPool } from '../src/pool.js'
import { resetConfig, configure } from '../src/configure.js'
import { resetTaskCounter } from '../src/spawn.js'

describe('ErrGroup', () => {
  beforeEach(() => {
    resetConfig()
    configure({ maxThreads: 4, idleTimeout: 1000 })
  })

  afterEach(async () => {
    await resetPool()
    resetTaskCounter()
  })

  it('waits for all tasks', async () => {
    const eg = new ErrGroup()
    eg.spawn(() => 1)
    eg.spawn(() => 2)
    eg.spawn(() => 3)
    const results = await eg.wait()
    expect(results).toEqual([1, 2, 3])
  })

  it('rejects with the first error', async () => {
    const eg = new ErrGroup()
    eg.spawn(() => 1)
    eg.spawn(() => {
      throw new Error('boom')
    })
    eg.spawn(() => 3)

    await expect(eg.wait()).rejects.toThrow('boom')
  })

  it('cancels remaining tasks on first error', async () => {
    const eg = new ErrGroup()

    eg.spawn(() => {
      throw new Error('fast fail')
    })
    eg.spawn(() => {
      let s = 0
      for (let i = 0; i < 100000000; i++) s += i
      return s
    })

    await expect(eg.wait()).rejects.toThrow('fast fail')
    expect(eg.signal.aborted).toBe(true)
  })

  it('exposes AbortSignal', () => {
    const eg = new ErrGroup()
    expect(eg.signal).toBeInstanceOf(AbortSignal)
    expect(eg.signal.aborted).toBe(false)
  })

  it('throws when spawning after cancel', () => {
    const eg = new ErrGroup()
    eg.cancel()
    expect(() => eg.spawn(() => 1)).toThrow('cancelled')
  })
})
