import { describe, it, expect } from 'vitest'
import { after } from '../src/after.js'

describe('after', () => {
  it('resolves after the specified time', async () => {
    const start = Date.now()
    await after(50)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(40) // allow some timer imprecision
  })

  it('resolves with undefined', async () => {
    const result = await after(1)
    expect(result).toBeUndefined()
  })

  it('can be used for timeout with select', async () => {
    const slow = new Promise<string>((resolve) =>
      setTimeout(() => resolve('done'), 200),
    )

    let timedOut = false
    const { select } = await import('../src/select.js')

    await select([
      [slow, () => {}],
      [after(10), () => { timedOut = true }],
    ])

    expect(timedOut).toBe(true)
  })
})
