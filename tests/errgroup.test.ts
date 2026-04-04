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

  describe('setLimit', () => {
    it('throws if called after spawn', () => {
      const eg = new ErrGroup()
      eg.spawn(() => 1)
      expect(() => eg.setLimit(2)).toThrow('SetLimit must be called before any spawn()')
    })

    it('throws on negative limit', () => {
      const eg = new ErrGroup()
      expect(() => eg.setLimit(-1)).toThrow(RangeError)
    })

    it('limits concurrent tasks', async () => {
      const eg = new ErrGroup<number>()
      eg.setLimit(2)

      // Spawn 4 tasks — only 2 should run at a time
      for (let i = 0; i < 4; i++) {
        eg.spawn(() => {
          let s = 0
          for (let j = 0; j < 100_000; j++) s += j
          return s
        })
      }

      const results = await eg.wait()
      expect(results).toHaveLength(4)
      expect(results.every((r) => r === 4999950000)).toBe(true)
    })

    it('still fails fast on error with limit', async () => {
      const eg = new ErrGroup()
      eg.setLimit(1)

      eg.spawn(() => {
        throw new Error('limited boom')
      })
      eg.spawn(() => 42)

      await expect(eg.wait()).rejects.toThrow('limited boom')
    })
  })
})
