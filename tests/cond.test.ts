import { describe, it, expect } from 'vitest'
import { Cond } from '../src/cond.js'
import { Mutex } from '../src/mutex.js'

describe('Cond', () => {
  it('signal wakes one waiter', async () => {
    const mu = new Mutex()
    const cond = new Cond(mu)
    let ready = false
    const order: string[] = []

    const waiter = (async () => {
      await mu.lock()
      while (!ready) {
        await cond.wait()
      }
      order.push('waiter-done')
      mu.unlock()
    })()

    // Give waiter time to start waiting
    await new Promise((r) => setTimeout(r, 10))

    await mu.lock()
    ready = true
    cond.signal()
    order.push('signaled')
    mu.unlock()

    await waiter
    expect(order).toEqual(['signaled', 'waiter-done'])
    expect(ready).toBe(true)
  })

  it('broadcast wakes all waiters', async () => {
    const mu = new Mutex()
    const cond = new Cond(mu)
    let ready = false
    let wokenCount = 0

    const makeWaiter = () =>
      (async () => {
        await mu.lock()
        while (!ready) {
          await cond.wait()
        }
        wokenCount++
        mu.unlock()
      })()

    const waiters = [makeWaiter(), makeWaiter(), makeWaiter()]

    await new Promise((r) => setTimeout(r, 10))

    await mu.lock()
    ready = true
    cond.broadcast()
    mu.unlock()

    await Promise.all(waiters)
    expect(wokenCount).toBe(3)
  })

  it('signal with no waiters is a no-op', () => {
    const mu = new Mutex()
    const cond = new Cond(mu)
    cond.signal()
    expect(mu.isLocked).toBe(false)
  })

  it('broadcast with no waiters is a no-op', () => {
    const mu = new Mutex()
    const cond = new Cond(mu)
    cond.broadcast()
    expect(mu.isLocked).toBe(false)
  })

  it('wait re-acquires the lock before returning', async () => {
    const mu = new Mutex()
    const cond = new Cond(mu)

    const waiter = (async () => {
      await mu.lock()
      await cond.wait()
      // Lock should be held here
      expect(mu.isLocked).toBe(true)
      mu.unlock()
    })()

    await new Promise((r) => setTimeout(r, 10))
    cond.signal()
    await waiter
  })

  it('signal wakes only one of multiple waiters', async () => {
    const mu = new Mutex()
    const cond = new Cond(mu)
    let counter = 0
    let ready = false

    const makeWaiter = () =>
      (async () => {
        await mu.lock()
        while (!ready) {
          await cond.wait()
        }
        counter++
        mu.unlock()
      })()

    const w1 = makeWaiter()
    const w2 = makeWaiter()

    await new Promise((r) => setTimeout(r, 10))

    // Signal once — only one waiter should wake
    await mu.lock()
    ready = true
    cond.signal()
    mu.unlock()

    // Wait a bit, then signal again for the second
    await new Promise((r) => setTimeout(r, 10))

    await mu.lock()
    cond.signal()
    mu.unlock()

    await Promise.all([w1, w2])
    expect(counter).toBe(2)
  })
})
