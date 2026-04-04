import { describe, it, expect, vi, afterEach } from 'vitest'
import { Timer } from '../src/timer.js'

describe('Timer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires after the given duration', async () => {
    vi.useFakeTimers()
    const t = new Timer(100)
    let fired = false
    t.channel.then(() => { fired = true })

    vi.advanceTimersByTime(99)
    await Promise.resolve()
    expect(fired).toBe(false)

    vi.advanceTimersByTime(1)
    await Promise.resolve()
    expect(fired).toBe(true)
    expect(t.stopped).toBe(true)
  })

  it('stop() prevents firing and returns true', async () => {
    vi.useFakeTimers()
    const t = new Timer(100)
    const wasStopped = t.stop()
    expect(wasStopped).toBe(true)
    expect(t.stopped).toBe(true)

    // channel should never resolve
    let resolved = false
    t.channel.then(() => { resolved = true })
    vi.advanceTimersByTime(200)
    await Promise.resolve()
    expect(resolved).toBe(false)
  })

  it('stop() returns false if already fired', async () => {
    vi.useFakeTimers()
    const t = new Timer(10)
    vi.advanceTimersByTime(10)
    await t.channel

    expect(t.stop()).toBe(false)
  })

  it('stop() returns false if already stopped', () => {
    const t = new Timer(100)
    t.stop()
    expect(t.stop()).toBe(false)
  })

  it('reset() reschedules the timer', async () => {
    vi.useFakeTimers()
    const t = new Timer(100)
    t.reset(200)

    vi.advanceTimersByTime(100)
    await Promise.resolve()
    expect(t.stopped).toBe(false)

    vi.advanceTimersByTime(100)
    await t.channel
    expect(t.stopped).toBe(true)
  })

  it('reset() creates a new channel promise', async () => {
    vi.useFakeTimers()
    const t = new Timer(100)
    const first = t.channel
    t.reset(50)
    const second = t.channel

    expect(first).not.toBe(second)

    // Second should resolve after 50ms
    vi.advanceTimersByTime(50)
    await second
    expect(t.stopped).toBe(true)
  })

  it('works with real timers', async () => {
    const t = new Timer(30)
    await t.channel
    expect(t.stopped).toBe(true)
  })
})
