import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { task, resetTaskCounter } from '../src/registry.js'
import { resetPool } from '../src/pool.js'
import { resetConfig, configure } from '../src/configure.js'

describe('task()', () => {
  beforeEach(() => {
    resetTaskCounter()
    resetConfig()
    configure({ maxThreads: 2, idleTimeout: 1000 })
  })

  afterEach(async () => {
    await resetPool()
  })

  it('runs a task with arguments', async () => {
    const add = task((a: number, b: number) => a + b)
    const result = await add(2, 3)
    expect(result).toBe(5)
  })

  it('handles async tasks', async () => {
    const asyncTask = task(async (x: number) => x * 2)
    const result = await asyncTask(5)
    expect(result).toBe(10)
  })

  it('rejects when the task throws', async () => {
    const fail = task(() => {
      throw new Error('task error')
    })
    await expect(fail()).rejects.toThrow('task error')
  })

  it('passes multiple arguments', async () => {
    const concat = task((...args: string[]) => args.join('-'))
    const result = await concat('a', 'b', 'c')
    expect(result).toBe('a-b-c')
  })

  it('can be called multiple times', async () => {
    const double = task((n: number) => n * 2)
    const [a, b, c] = await Promise.all([double(1), double(2), double(3)])
    expect(a).toBe(2)
    expect(b).toBe(4)
    expect(c).toBe(6)
  })

  it('throws on non-JSON-serializable arguments', () => {
    const noop = task((_x: string | null) => null)
    expect(() => noop(undefined as never)).toThrow('not JSON-serializable')
  })

  it('runs a task with no arguments', async () => {
    const constant = task(() => 'no args')
    const result = await constant()
    expect(result).toBe('no args')
  })

  it('passes null as a valid argument', async () => {
    const echo = task((x: string | null) => x)
    const result = await echo(null)
    expect(result).toBeNull()
  })

  it('passes deeply nested objects', async () => {
    const echo = task((obj: { a: { b: { c: number[] } } }) => obj.a.b.c[1])
    const result = await echo({ a: { b: { c: [10, 20, 30] } } })
    expect(result).toBe(20)
  })

  it('passes empty arrays and objects', async () => {
    const echo = task((arr: number[], obj: Record<string, number>) => ({
      arrLen: arr.length,
      objKeys: Object.keys(obj).length,
    }))
    const result = await echo([], {})
    expect(result).toEqual({ arrLen: 0, objKeys: 0 })
  })

  it('passes boolean and null-heavy args correctly', async () => {
    const fn = task((a: boolean, b: null, c: boolean) => [a, b, c])
    const result = await fn(false, null, true)
    expect(result).toEqual([false, null, true])
  })

  it('enriches error stack with task call site', async () => {
    const fail = task(() => {
      throw new Error('task stack test')
    })
    const err = await fail().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).stack).toContain('--- spawned at ---')
  })

  it('rejects when async task rejects a promise', async () => {
    const fail = task(async () => {
      return Promise.reject(new Error('async task rejection'))
    })
    await expect(fail()).rejects.toThrow('async task rejection')
  })

  it('rejects with TypeError from task', async () => {
    const fail = task(() => {
      throw new TypeError('bad task type')
    })
    await expect(fail()).rejects.toThrow('bad task type')
  })

  it('error in one call does not break subsequent calls', async () => {
    const mayFail = task((shouldFail: boolean) => {
      if (shouldFail) throw new Error('conditional fail')
      return 'ok'
    })
    await expect(mayFail(true)).rejects.toThrow('conditional fail')
    expect(await mayFail(false)).toBe('ok')
  })

  it('multiple calls can fail independently', async () => {
    const mayFail = task((shouldFail: boolean) => {
      if (shouldFail) throw new Error('selective fail')
      return 'ok'
    })
    const results = await Promise.allSettled([
      mayFail(true),
      mayFail(false),
      mayFail(true),
      mayFail(false),
    ])
    expect(results[0].status).toBe('rejected')
    expect(results[1]).toEqual({ status: 'fulfilled', value: 'ok' })
    expect(results[2].status).toBe('rejected')
    expect(results[3]).toEqual({ status: 'fulfilled', value: 'ok' })
  })

  it('handles many concurrent calls to the same task', async () => {
    const double = task((n: number) => n * 2)
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => double(i)),
    )
    expect(results).toEqual(Array.from({ length: 50 }, (_, i) => i * 2))
  })
})
