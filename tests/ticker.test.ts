import { describe, it, expect } from 'vitest'
import { Ticker, ticker } from '../src/ticker.js'

describe('Ticker', () => {
  it('ticks at the specified interval', async () => {
    const t = ticker(50)
    const start = Date.now()

    expect(await t.tick()).toBe(true)
    expect(await t.tick()).toBe(true)

    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(80)

    t.stop()
  })

  it('returns false after stop', async () => {
    const t = ticker(20)
    expect(await t.tick()).toBe(true)
    t.stop()
    expect(await t.tick()).toBe(false)
  })

  it('resolves pending tick with false when stop() is called mid-wait', async () => {
    const t = ticker(10_000) // very long interval — tick() will block

    // Start waiting for a tick that will never naturally fire
    const tickPromise = t.tick()

    // stop() should immediately resolve the pending tick with false
    t.stop()

    expect(await tickPromise).toBe(false)
  })

  it('does not deliver an extra tick after stop()', async () => {
    const t = ticker(20)
    let count = 0

    // Simulate a caller that checks shouldStop after each tick
    for await (const _ of t) {
      count++
      t.stop() // stop after first tick — should not yield again
    }

    expect(count).toBe(1)
  })

  it('works with async iteration', async () => {
    const t = ticker(20)
    let count = 0

    for await (const _ of t) {
      count++
      if (count >= 3) {
        t.stop()
      }
    }

    expect(count).toBe(3)
  })

  it('returns false immediately after stop, even before any tick', async () => {
    const t = ticker(10_000)
    t.stop()
    expect(await t.tick()).toBe(false)
  })

  it('factory function creates a Ticker', () => {
    const t = ticker(100)
    expect(t).toBeInstanceOf(Ticker)
    t.stop()
  })
})
