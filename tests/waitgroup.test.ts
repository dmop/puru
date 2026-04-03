import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WaitGroup } from '../src/waitgroup.js'
import { resetPool } from '../src/pool.js'
import { resetConfig, configure } from '../src/configure.js'
import { resetTaskCounter } from '../src/spawn.js'

describe('WaitGroup', () => {
  beforeEach(() => {
    resetConfig()
    configure({ maxThreads: 4, idleTimeout: 1000 })
  })

  afterEach(async () => {
    await resetPool()
    resetTaskCounter()
  })

  it('waits for all spawned tasks', async () => {
    const wg = new WaitGroup()
    wg.spawn(() => 1)
    wg.spawn(() => 2)
    wg.spawn(() => 3)
    const results = await wg.wait()
    expect(results).toEqual([1, 2, 3])
  })

  it('waitSettled returns all results including failures', async () => {
    const wg = new WaitGroup()
    wg.spawn(() => 'ok')
    wg.spawn(() => {
      throw new Error('fail')
    })

    const results = await wg.waitSettled()
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ status: 'fulfilled', value: 'ok' })
    expect(results[1]).toMatchObject({ status: 'rejected' })
  })

  it('wait rejects if any task fails', async () => {
    const wg = new WaitGroup()
    wg.spawn(() => 1)
    wg.spawn(() => {
      throw new Error('boom')
    })

    await expect(wg.wait()).rejects.toThrow('boom')
  })

  it('exposes an AbortSignal', () => {
    const wg = new WaitGroup()
    expect(wg.signal).toBeInstanceOf(AbortSignal)
    expect(wg.signal.aborted).toBe(false)
  })

  it('cancel aborts the signal', () => {
    const wg = new WaitGroup()
    wg.cancel()
    expect(wg.signal.aborted).toBe(true)
  })

  it('throws when spawning after cancel', () => {
    const wg = new WaitGroup()
    wg.cancel()
    expect(() => wg.spawn(() => 1)).toThrow('WaitGroup has been cancelled')
  })
})
