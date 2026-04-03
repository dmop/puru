import { describe, it, expect } from 'vitest'
import { Mutex } from '../src/mutex.js'

describe('Mutex', () => {
  it('allows lock/unlock', async () => {
    const mu = new Mutex()
    await mu.lock()
    expect(mu.isLocked).toBe(true)
    mu.unlock()
    expect(mu.isLocked).toBe(false)
  })

  it('queues concurrent lock attempts', async () => {
    const mu = new Mutex()
    const order: number[] = []

    await mu.lock()

    const p1 = mu.lock().then(() => {
      order.push(1)
      mu.unlock()
    })
    const p2 = mu.lock().then(() => {
      order.push(2)
      mu.unlock()
    })

    mu.unlock() // releases to p1
    await p1
    await p2

    expect(order).toEqual([1, 2])
  })

  it('serializes withLock calls', async () => {
    const mu = new Mutex()
    let counter = 0

    await Promise.all(
      Array.from({ length: 10 }, () =>
        mu.withLock(async () => {
          const val = counter
          await new Promise((r) => setTimeout(r, 1))
          counter = val + 1
        }),
      ),
    )

    expect(counter).toBe(10)
  })

  it('withLock returns the value', async () => {
    const mu = new Mutex()
    const result = await mu.withLock(() => 42)
    expect(result).toBe(42)
  })

  it('withLock unlocks on error', async () => {
    const mu = new Mutex()
    await expect(
      mu.withLock(() => {
        throw new Error('fail')
      }),
    ).rejects.toThrow('fail')
    expect(mu.isLocked).toBe(false)
  })

  it('throws on double unlock', () => {
    const mu = new Mutex()
    expect(() => mu.unlock()).toThrow('not locked')
  })
})
