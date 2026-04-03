import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn, resetTaskCounter } from '../src/spawn.js'
import { chan, resetChannelRegistry } from '../src/channel.js'
import { resetPool } from '../src/pool.js'
import { resetConfig, configure } from '../src/configure.js'

describe('channels in workers', () => {
  beforeEach(() => {
    resetConfig()
    configure({ maxThreads: 4, idleTimeout: 1000 })
  })

  afterEach(async () => {
    await resetPool()
    resetTaskCounter()
    resetChannelRegistry()
  })

  it('worker sends, main thread receives', async () => {
    const ch = chan<number>(1)
    spawn(async ({ ch }) => {
      await ch.send(42)
    }, { channels: { ch } })

    expect(await ch.recv()).toBe(42)
  })

  it('main thread sends, worker receives', async () => {
    const ch = chan<number>(1)
    await ch.send(99)

    const { result } = spawn(async ({ ch }) => {
      return await ch.recv()
    }, { channels: { ch } })

    expect(await result).toBe(99)
  })

  it('worker-to-worker communication via shared channel', async () => {
    const ch = chan<number>(10)

    // Producer
    spawn(async ({ ch }) => {
      for (let i = 0; i < 5; i++) await ch.send(i)
      ch.close()
    }, { channels: { ch }, concurrent: true })

    // Consumer
    const { result } = spawn(async ({ ch }) => {
      const values: number[] = []
      for await (const v of ch as AsyncIterable<number>) values.push(v)
      return values
    }, { channels: { ch }, concurrent: true })

    expect(await result).toEqual([0, 1, 2, 3, 4])
  })

  it('unbuffered channel between workers', async () => {
    const ch = chan<string>()

    spawn(async ({ ch }) => {
      await ch.send('hello')
    }, { channels: { ch }, concurrent: true })

    const { result } = spawn(async ({ ch }) => {
      return await ch.recv()
    }, { channels: { ch }, concurrent: true })

    expect(await result).toBe('hello')
  })

  it('async iteration in worker', async () => {
    const ch = chan<number>(5)

    // Send from main thread
    await ch.send(10)
    await ch.send(20)
    await ch.send(30)
    ch.close()

    const { result } = spawn(async ({ ch }) => {
      const values: number[] = []
      for await (const v of ch as AsyncIterable<number>) values.push(v)
      return values
    }, { channels: { ch } })

    expect(await result).toEqual([10, 20, 30])
  })

  it('close from main thread stops worker iteration', async () => {
    const ch = chan<number>(10)

    const { result } = spawn(async ({ ch }) => {
      const values: number[] = []
      for await (const v of ch as AsyncIterable<number>) values.push(v)
      return values
    }, { channels: { ch }, concurrent: true })

    await ch.send(1)
    await ch.send(2)
    ch.close()

    expect(await result).toEqual([1, 2])
  })

  it('send on closed channel from worker rejects', async () => {
    const ch = chan<number>()
    ch.close()

    const { result } = spawn(async ({ ch }) => {
      await ch.send(1)
    }, { channels: { ch } })

    await expect(result).rejects.toThrow('send on closed channel')
  })

  it('multiple channels passed to one worker', async () => {
    const input = chan<number>(10)
    const output = chan<string>(10)

    spawn(async ({ input, output }) => {
      for await (const n of input as AsyncIterable<number>) {
        await output.send(String(n * 2))
      }
      output.close()
    }, { channels: { input, output }, concurrent: true })

    await input.send(1)
    await input.send(2)
    await input.send(3)
    input.close()

    const results: string[] = []
    for await (const v of output) results.push(v)

    expect(results).toEqual(['2', '4', '6'])
  })

  it('pipeline: worker A → channel → worker B → main thread', async () => {
    const stage1 = chan<number>(5)
    const stage2 = chan<string>(5)

    // Worker A: produce numbers
    spawn(async ({ out }) => {
      await out.send(10)
      await out.send(20)
      out.close()
    }, { channels: { out: stage1 }, concurrent: true })

    // Worker B: transform numbers to strings
    spawn(async ({ input, output }) => {
      for await (const n of input) {
        await output.send(`val:${n}`)
      }
      output.close()
    }, { channels: { input: stage1, output: stage2 }, concurrent: true })

    // Main thread consumes
    const results: string[] = []
    for await (const v of stage2) results.push(v)

    expect(results).toEqual(['val:10', 'val:20'])
  })

  it('structured-cloneable objects through channels', async () => {
    const ch = chan<{ name: string; values: number[] }>(1)

    spawn(async ({ ch }) => {
      await ch.send({ name: 'test', values: [1, 2, 3] })
    }, { channels: { ch } })

    const received = await ch.recv()
    expect(received).toEqual({ name: 'test', values: [1, 2, 3] })
  })

  it('channel recv returns null after close', async () => {
    const ch = chan<number>()

    const { result } = spawn(async ({ ch }) => {
      ch.close()
      return await ch.recv()
    }, { channels: { ch } })

    expect(await result).toBeNull()
  })
})
