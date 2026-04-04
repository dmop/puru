import { describe, it, expect } from 'vitest'
import { Semaphore } from '../src/semaphore.js'

describe('Semaphore', () => {
  it('allows acquiring up to capacity', () => {
    const sem = new Semaphore(3)
    expect(sem.available).toBe(3)
    expect(sem.capacity).toBe(3)

    sem.tryAcquire()
    expect(sem.available).toBe(2)

    sem.tryAcquire()
    sem.tryAcquire()
    expect(sem.available).toBe(0)
  })

  it('blocks when capacity is exhausted', async () => {
    const sem = new Semaphore(2)
    await sem.acquire()
    await sem.acquire()

    let acquired = false
    const pending = sem.acquire().then(() => { acquired = true })

    // Let microtasks flush
    await Promise.resolve()
    expect(acquired).toBe(false)

    sem.release()
    await pending
    expect(acquired).toBe(true)
  })

  it('tryAcquire returns false when full', () => {
    const sem = new Semaphore(1)
    expect(sem.tryAcquire()).toBe(true)
    expect(sem.tryAcquire()).toBe(false)
    expect(sem.available).toBe(0)
  })

  it('release wakes queued acquirers in FIFO order', async () => {
    const sem = new Semaphore(1)
    await sem.acquire()

    const order: number[] = []
    const p1 = sem.acquire().then(() => order.push(1))
    const p2 = sem.acquire().then(() => order.push(2))

    sem.release()
    await p1

    sem.release()
    await p2

    expect(order).toEqual([1, 2])
  })

  it('supports weighted acquire', async () => {
    const sem = new Semaphore(10)
    await sem.acquire(7)
    expect(sem.available).toBe(3)

    // Can't fit 5 more
    expect(sem.tryAcquire(5)).toBe(false)
    // Can fit 3
    expect(sem.tryAcquire(3)).toBe(true)
    expect(sem.available).toBe(0)

    sem.release(7)
    expect(sem.available).toBe(7)
    sem.release(3)
    expect(sem.available).toBe(10)
  })

  it('weighted acquire blocks until enough permits free', async () => {
    const sem = new Semaphore(5)
    await sem.acquire(3)

    let acquired = false
    const pending = sem.acquire(4).then(() => { acquired = true })

    await Promise.resolve()
    expect(acquired).toBe(false)

    sem.release(1)
    await Promise.resolve()
    expect(acquired).toBe(false) // still only 3 available

    sem.release(2) // now 5 available, 4 needed
    await pending
    expect(acquired).toBe(true)
    expect(sem.available).toBe(1)
  })

  it('withAcquire auto-releases on success', async () => {
    const sem = new Semaphore(2)
    const result = await sem.withAcquire(async () => {
      expect(sem.available).toBe(1)
      return 42
    })
    expect(result).toBe(42)
    expect(sem.available).toBe(2)
  })

  it('withAcquire auto-releases on error', async () => {
    const sem = new Semaphore(2)
    await expect(
      sem.withAcquire(async () => { throw new Error('boom') }),
    ).rejects.toThrow('boom')
    expect(sem.available).toBe(2)
  })

  it('withAcquire supports weighted acquire', async () => {
    const sem = new Semaphore(10)
    await sem.withAcquire(async () => {
      expect(sem.available).toBe(5)
    }, 5)
    expect(sem.available).toBe(10)
  })

  it('throws on release more than acquired', () => {
    const sem = new Semaphore(5)
    expect(() => sem.release()).toThrow('Released more permits than acquired')
  })

  it('throws if acquire count exceeds capacity', async () => {
    const sem = new Semaphore(3)
    await expect(sem.acquire(4)).rejects.toThrow('exceeds semaphore capacity')
    expect(() => sem.tryAcquire(4)).toThrow('exceeds semaphore capacity')
  })

  it('throws on invalid constructor argument', () => {
    expect(() => new Semaphore(0)).toThrow('positive integer')
    expect(() => new Semaphore(-1)).toThrow('positive integer')
    expect(() => new Semaphore(1.5)).toThrow('positive integer')
  })

  it('throws on invalid acquire/release counts', async () => {
    const sem = new Semaphore(5)
    await expect(sem.acquire(0)).rejects.toThrow('positive integer')
    await expect(sem.acquire(-1)).rejects.toThrow('positive integer')
    expect(() => sem.tryAcquire(0)).toThrow('positive integer')
    expect(() => sem.release(0)).toThrow('positive integer')
  })

  it('handles concurrent withAcquire calls', async () => {
    const sem = new Semaphore(2)
    const active: number[] = []
    let maxConcurrent = 0

    const task = async (id: number) => {
      return sem.withAcquire(async () => {
        active.push(id)
        maxConcurrent = Math.max(maxConcurrent, active.length)
        await new Promise((r) => setTimeout(r, 10))
        active.splice(active.indexOf(id), 1)
        return id
      })
    }

    const results = await Promise.all([task(1), task(2), task(3), task(4)])
    expect(results).toEqual([1, 2, 3, 4])
    expect(maxConcurrent).toBeLessThanOrEqual(2)
  })

  it('preserves FIFO even with mixed weights', async () => {
    const sem = new Semaphore(5)
    await sem.acquire(4) // 1 available

    const order: string[] = []
    const p1 = sem.acquire(2).then(() => order.push('heavy'))  // needs 2, blocked
    const p2 = sem.acquire(1).then(() => order.push('light'))  // needs 1, but queued behind heavy

    await Promise.resolve()
    expect(order).toEqual([])

    sem.release(4) // 5 available — heavy (2) goes first, then light (1)
    await p1
    await p2
    expect(order).toEqual(['heavy', 'light'])
  })

  it('does not wake out-of-order when head is too large', async () => {
    const sem = new Semaphore(4)
    await sem.acquire(3) // 1 available

    let heavyDone = false
    let lightDone = false
    const pHeavy = sem.acquire(3).then(() => { heavyDone = true }) // needs 3, blocked
    const pLight = sem.acquire(1).then(() => { lightDone = true }) // needs 1, fits but queued behind heavy

    await Promise.resolve()
    expect(heavyDone).toBe(false)
    expect(lightDone).toBe(false) // FIFO — light waits behind heavy

    sem.release(1) // 2 available — still not enough for heavy (3)
    await Promise.resolve()
    expect(heavyDone).toBe(false)
    expect(lightDone).toBe(false) // still blocked

    sem.release(1) // 3 available — heavy can proceed
    await pHeavy
    expect(heavyDone).toBe(true)

    // Now heavy holds 3, light still needs 1, only 1 available
    sem.release(3)
    await pLight
    expect(lightDone).toBe(true)
  })
})
