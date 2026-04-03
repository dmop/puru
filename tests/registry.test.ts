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
    const noop = task((_x: unknown) => null)
    expect(() => noop(undefined)).toThrow('not JSON-serializable')
  })
})
