import { describe, it, expect } from 'vitest'
import { select } from '../src/select.js'
import { after } from '../src/after.js'
import { chan } from '../src/channel.js'

describe('select', () => {
  it('resolves with the first promise to settle', async () => {
    let result = ''
    await select([
      [after(100), () => { result = 'slow' }],
      [after(10), () => { result = 'fast' }],
    ])
    expect(result).toBe('fast')
  })

  it('passes the resolved value to the handler', async () => {
    let received: number | null = null
    await select([
      [Promise.resolve(42), (v) => { received = v as number }],
      [after(100), () => { received = -1 }],
    ])
    expect(received).toBe(42)
  })

  it('only calls the first handler', async () => {
    const calls: string[] = []
    await select([
      [Promise.resolve('a'), () => calls.push('first')],
      [Promise.resolve('b'), () => calls.push('second')],
    ])
    // Allow microtask to process second resolve
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toEqual(['first'])
  })

  it('rejects if the winning promise rejects', async () => {
    await expect(
      select([
        [Promise.reject(new Error('fail')), () => {}],
        [after(100), () => {}],
      ]),
    ).rejects.toThrow('fail')
  })

  it('rejects if the handler throws', async () => {
    await expect(
      select([
        [Promise.resolve(1), () => { throw new Error('handler error') }],
      ]),
    ).rejects.toThrow('handler error')
  })

  it('resolves immediately for empty cases', async () => {
    await select([])
    expect(true).toBe(true)
  })

  describe('default case', () => {
    it('runs default when no promise is immediately ready', async () => {
      let result = ''
      await select(
        [[after(100), () => { result = 'promise' }]],
        { default: () => { result = 'default' } },
      )
      expect(result).toBe('default')
    })

    it('runs the promise handler if already resolved', async () => {
      let result = ''
      await select(
        [[Promise.resolve('val'), () => { result = 'promise' }]],
        { default: () => { result = 'default' } },
      )
      expect(result).toBe('promise')
    })

    it('runs default on empty cases', async () => {
      let called = false
      await select([], { default: () => { called = true } })
      expect(called).toBe(true)
    })
  })

  describe('send cases', () => {
    it('select with ch.send() completes when send succeeds', async () => {
      const ch = chan<number>(1)
      let sent = false
      await select([
        [ch.send(42), () => { sent = true }],
        [after(1000), () => { sent = false }],
      ])
      expect(sent).toBe(true)
      expect(await ch.recv()).toBe(42)
    })

    it('select with ch.send() on full channel times out', async () => {
      const ch = chan<number>(1)
      await ch.send(1) // fill the buffer

      let result = ''
      await select([
        [ch.send(2), () => { result = 'sent' }],
        [after(20), () => { result = 'timeout' }],
      ])
      expect(result).toBe('timeout')
    })

    it('select with send and recv cases', async () => {
      const input = chan<number>(1)
      const output = chan<number>(1)
      await input.send(99)

      let result = ''
      await select([
        [input.recv(), (v) => { result = `recv:${v}` }],
        [output.send(1), () => { result = 'sent' }],
      ])
      // recv should win since input has a value ready
      expect(result).toBe('recv:99')
    })
  })
})
