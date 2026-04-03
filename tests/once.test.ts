import { describe, it, expect } from 'vitest'
import { Once } from '../src/once.js'

describe('Once', () => {
  it('runs the function only once', async () => {
    let count = 0
    const once = new Once()

    await once.do(() => {
      count++
    })
    await once.do(() => {
      count++
    })
    await once.do(() => {
      count++
    })

    expect(count).toBe(1)
  })

  it('returns the same value every time', async () => {
    const once = new Once<number>()
    const a = await once.do(() => 42)
    const b = await once.do(() => 99)
    expect(a).toBe(42)
    expect(b).toBe(42)
  })

  it('handles async functions', async () => {
    const once = new Once<string>()
    const result = await once.do(async () => {
      return 'async value'
    })
    expect(result).toBe('async value')
  })

  it('reports done status', async () => {
    const once = new Once()
    expect(once.done).toBe(false)
    await once.do(() => {})
    expect(once.done).toBe(true)
  })

  it('can be reset', async () => {
    let count = 0
    const once = new Once()
    await once.do(() => count++)
    once.reset()
    await once.do(() => count++)
    expect(count).toBe(2)
  })

  it('concurrent calls only execute once', async () => {
    let count = 0
    const once = new Once<number>()
    const results = await Promise.all([
      once.do(() => ++count),
      once.do(() => ++count),
      once.do(() => ++count),
    ])
    expect(count).toBe(1)
    expect(results).toEqual([1, 1, 1])
  })
})
