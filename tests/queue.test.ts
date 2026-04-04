import { describe, it, expect } from 'vitest'
import { RingBuffer, FifoQueue } from '../src/queue.js'

describe('RingBuffer', () => {
  it('push and shift maintain FIFO order', () => {
    const rb = new RingBuffer<number>(4)
    rb.push(1)
    rb.push(2)
    rb.push(3)
    expect(rb.shift()).toBe(1)
    expect(rb.shift()).toBe(2)
    expect(rb.shift()).toBe(3)
  })

  it('tracks length correctly', () => {
    const rb = new RingBuffer<number>(3)
    expect(rb.length).toBe(0)
    rb.push(10)
    expect(rb.length).toBe(1)
    rb.push(20)
    expect(rb.length).toBe(2)
    rb.shift()
    expect(rb.length).toBe(1)
    rb.shift()
    expect(rb.length).toBe(0)
  })

  it('shift returns undefined when empty', () => {
    const rb = new RingBuffer<number>(2)
    expect(rb.shift()).toBeUndefined()
  })

  it('wraps around correctly at capacity', () => {
    const rb = new RingBuffer<number>(3)
    rb.push(1)
    rb.push(2)
    rb.push(3)
    // Buffer is full [1, 2, 3], head=0, tail=0 (wrapped)
    expect(rb.shift()).toBe(1) // head advances
    rb.push(4) // fills the freed slot
    expect(rb.shift()).toBe(2)
    expect(rb.shift()).toBe(3)
    expect(rb.shift()).toBe(4)
    expect(rb.length).toBe(0)
  })

  it('handles capacity=0 gracefully', () => {
    const rb = new RingBuffer<number>(0)
    expect(rb.length).toBe(0)
    expect(rb.shift()).toBeUndefined()
  })

  it('releases references on shift', () => {
    const rb = new RingBuffer<{ data: string }>(2)
    const obj = { data: 'test' }
    rb.push(obj)
    const retrieved = rb.shift()
    expect(retrieved).toBe(obj)
    // After shift, the internal slot should be cleared (not observable from public API,
    // but we can verify by pushing/shifting again that no stale data leaks)
    rb.push({ data: 'new' })
    expect(rb.shift()!.data).toBe('new')
  })
})

describe('FifoQueue', () => {
  it('push and shift maintain FIFO order', () => {
    const q = new FifoQueue<number>()
    q.push(1)
    q.push(2)
    q.push(3)
    expect(q.shift()).toBe(1)
    expect(q.shift()).toBe(2)
    expect(q.shift()).toBe(3)
  })

  it('tracks length correctly', () => {
    const q = new FifoQueue<number>()
    expect(q.length).toBe(0)
    q.push(10)
    expect(q.length).toBe(1)
    q.push(20)
    expect(q.length).toBe(2)
    q.shift()
    expect(q.length).toBe(1)
    q.shift()
    expect(q.length).toBe(0)
  })

  it('shift returns undefined when empty', () => {
    const q = new FifoQueue<number>()
    expect(q.shift()).toBeUndefined()
  })

  it('clear empties the queue', () => {
    const q = new FifoQueue<number>()
    q.push(1)
    q.push(2)
    q.push(3)
    q.clear()
    expect(q.length).toBe(0)
    expect(q.shift()).toBeUndefined()
  })

  it('supports iteration', () => {
    const q = new FifoQueue<number>()
    q.push(10)
    q.push(20)
    q.push(30)
    const values = [...q]
    expect(values).toEqual([10, 20, 30])
  })

  it('iteration is safe before clear', () => {
    const q = new FifoQueue<number>()
    q.push(1)
    q.push(2)
    q.push(3)

    // Simulate the close() pattern: iterate then clear
    const collected: number[] = []
    for (const v of q) {
      collected.push(v)
    }
    q.clear()

    expect(collected).toEqual([1, 2, 3])
    expect(q.length).toBe(0)
  })

  it('works after clear and re-use', () => {
    const q = new FifoQueue<string>()
    q.push('a')
    q.push('b')
    q.clear()
    q.push('c')
    expect(q.shift()).toBe('c')
    expect(q.length).toBe(0)
  })

  it('handles single-element operations', () => {
    const q = new FifoQueue<number>()
    q.push(42)
    expect(q.length).toBe(1)
    expect(q.shift()).toBe(42)
    expect(q.length).toBe(0)
    expect(q.shift()).toBeUndefined()
  })
})
