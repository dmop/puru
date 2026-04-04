import { describe, it, expect } from 'vitest'
import { Mutex, RWMutex } from '../src/mutex.js'

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

describe('RWMutex', () => {
  it('allows multiple concurrent readers', async () => {
    const rw = new RWMutex()
    let concurrent = 0
    let maxConcurrent = 0

    await Promise.all(
      Array.from({ length: 5 }, () =>
        rw.withRLock(async () => {
          concurrent++
          maxConcurrent = Math.max(maxConcurrent, concurrent)
          await new Promise((r) => setTimeout(r, 10))
          concurrent--
        }),
      ),
    )

    expect(maxConcurrent).toBe(5)
  })

  it('writer gets exclusive access', async () => {
    const rw = new RWMutex()
    let counter = 0

    await Promise.all(
      Array.from({ length: 10 }, () =>
        rw.withLock(async () => {
          const val = counter
          await new Promise((r) => setTimeout(r, 1))
          counter = val + 1
        }),
      ),
    )

    expect(counter).toBe(10)
  })

  it('writer waits for readers to finish', async () => {
    const rw = new RWMutex()
    const order: string[] = []

    await rw.rLock()

    const writePromise = rw.withLock(async () => {
      order.push('write')
    })

    // Writer should be blocked
    await new Promise((r) => setTimeout(r, 10))
    order.push('read-done')
    rw.rUnlock()

    await writePromise
    expect(order).toEqual(['read-done', 'write'])
  })

  it('readers wait while writer holds lock', async () => {
    const rw = new RWMutex()
    const order: string[] = []

    await rw.lock()

    const readPromise = rw.withRLock(async () => {
      order.push('read')
    })

    await new Promise((r) => setTimeout(r, 10))
    order.push('write-done')
    rw.unlock()

    await readPromise
    expect(order).toEqual(['write-done', 'read'])
  })

  it('withRLock returns the value', async () => {
    const rw = new RWMutex()
    const result = await rw.withRLock(() => 42)
    expect(result).toBe(42)
  })

  it('withRLock unlocks on error', async () => {
    const rw = new RWMutex()
    await expect(
      rw.withRLock(() => {
        throw new Error('fail')
      }),
    ).rejects.toThrow('fail')
    expect(rw.isLocked).toBe(false)
  })

  it('throws on rUnlock without rLock', () => {
    const rw = new RWMutex()
    expect(() => rw.rUnlock()).toThrow('not read-locked')
  })

  it('throws on unlock without lock', () => {
    const rw = new RWMutex()
    expect(() => rw.unlock()).toThrow('not write-locked')
  })

  it('writers are not starved by readers', async () => {
    const rw = new RWMutex()
    const order: string[] = []

    // Acquire a read lock
    await rw.rLock()

    // Queue a writer
    const writeP = (async () => {
      await rw.lock()
      order.push('writer')
      rw.unlock()
    })()

    // Queue another reader — should wait behind the writer
    const readP = (async () => {
      await rw.rLock()
      order.push('reader2')
      rw.rUnlock()
    })()

    // Release the first read lock — writer should go first
    rw.rUnlock()
    await writeP
    await readP

    expect(order).toEqual(['writer', 'reader2'])
  })
})
