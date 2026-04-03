import { describe, it, expect } from 'vitest'
import { select } from '../src/select.js'
import { after } from '../src/after.js'

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
})
