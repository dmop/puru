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

  it('factory function creates a Ticker', () => {
    const t = ticker(100)
    expect(t).toBeInstanceOf(Ticker)
    t.stop()
  })
})
