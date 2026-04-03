import { describe, it, expect } from 'vitest'
import { chan } from '../src/channel.js'

describe('chan', () => {
  it('throws on negative capacity', () => {
    expect(() => chan(-1)).toThrow(RangeError)
  })

  it('throws on non-integer capacity', () => {
    expect(() => chan(1.5)).toThrow(RangeError)
  })

  describe('buffered channel', () => {
    it('sends and receives values', async () => {
      const ch = chan<number>(3)
      await ch.send(1)
      await ch.send(2)
      await ch.send(3)
      expect(await ch.recv()).toBe(1)
      expect(await ch.recv()).toBe(2)
      expect(await ch.recv()).toBe(3)
    })

    it('blocks send when buffer is full', async () => {
      const ch = chan<number>(1)
      await ch.send(1) // fills buffer

      let sent = false
      const sendPromise = ch.send(2).then(() => {
        sent = true
      })

      // send should be blocked
      await Promise.resolve()
      expect(sent).toBe(false)

      // recv unblocks the send
      expect(await ch.recv()).toBe(1)
      await sendPromise
      expect(sent).toBe(true)
      expect(await ch.recv()).toBe(2)
    })

    it('blocks recv when buffer is empty', async () => {
      const ch = chan<number>(3)

      let received: number | null = null
      const recvPromise = ch.recv().then((v) => {
        received = v
      })

      await Promise.resolve()
      expect(received).toBeNull()

      await ch.send(42)
      await recvPromise
      expect(received).toBe(42)
    })
  })

  describe('unbuffered channel', () => {
    it('send blocks until recv', async () => {
      const ch = chan<number>()

      let sent = false
      const sendPromise = ch.send(1).then(() => {
        sent = true
      })

      await Promise.resolve()
      expect(sent).toBe(false)

      const value = await ch.recv()
      await sendPromise
      expect(value).toBe(1)
      expect(sent).toBe(true)
    })

    it('recv blocks until send', async () => {
      const ch = chan<string>()

      let received: string | null = null
      const recvPromise = ch.recv().then((v) => {
        received = v
      })

      await Promise.resolve()
      expect(received).toBeNull()

      await ch.send('hello')
      await recvPromise
      expect(received).toBe('hello')
    })

    it('handles ping-pong correctly', async () => {
      const ch = chan<number>()
      const results: number[] = []

      const producer = (async () => {
        await ch.send(1)
        await ch.send(2)
        await ch.send(3)
        ch.close()
      })()

      const consumer = (async () => {
        for await (const v of ch) {
          results.push(v)
        }
      })()

      await Promise.all([producer, consumer])
      expect(results).toEqual([1, 2, 3])
    })
  })

  describe('close', () => {
    it('returns null on recv after close', async () => {
      const ch = chan<number>(3)
      await ch.send(1)
      ch.close()
      expect(await ch.recv()).toBe(1) // drain buffer
      expect(await ch.recv()).toBeNull() // closed
    })

    it('throws on send after close', async () => {
      const ch = chan<number>(3)
      ch.close()
      await expect(ch.send(1)).rejects.toThrow('send on closed channel')
    })

    it('resolves pending receivers with null on close', async () => {
      const ch = chan<number>()

      const recvPromise = ch.recv()
      ch.close()
      expect(await recvPromise).toBeNull()
    })

    it('rejects pending senders on close', async () => {
      const ch = chan<number>()

      const sendPromise = ch.send(1)
      ch.close()
      await expect(sendPromise).rejects.toThrow('send on closed channel')
    })

    it('is idempotent', () => {
      const ch = chan<number>()
      ch.close()
      ch.close() // should not throw
      expect(ch).toBeDefined()
    })
  })

  describe('async iteration', () => {
    it('iterates over all values until close', async () => {
      const ch = chan<number>(5)
      await ch.send(10)
      await ch.send(20)
      await ch.send(30)
      ch.close()

      const values: number[] = []
      for await (const v of ch) {
        values.push(v)
      }
      expect(values).toEqual([10, 20, 30])
    })

    it('waits for values when channel is empty', async () => {
      const ch = chan<number>()
      const values: number[] = []

      const consumer = (async () => {
        for await (const v of ch) {
          values.push(v)
        }
      })()

      await ch.send(1)
      await ch.send(2)
      ch.close()
      await consumer
      expect(values).toEqual([1, 2])
    })
  })
})
