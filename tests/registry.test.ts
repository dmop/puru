import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { register, run, clearRegistry } from '../src/registry.js'
import { resetPool } from '../src/pool.js'
import { resetConfig, configure } from '../src/configure.js'

describe('register + run', () => {
  beforeEach(() => {
    clearRegistry()
    resetConfig()
    configure({ maxThreads: 2, idleTimeout: 1000 })
  })

  afterEach(async () => {
    await resetPool()
  })

  it('registers and runs a task by name', async () => {
    register('add', (a: unknown, b: unknown) => (a as number) + (b as number))
    const result = await run<number>('add', 2, 3)
    expect(result).toBe(5)
  })

  it('throws when running an unregistered task', () => {
    expect(() => run('nonexistent')).toThrow('not registered')
  })

  it('throws when registering a duplicate name', () => {
    register('dup', () => 1)
    expect(() => register('dup', () => 2)).toThrow('already registered')
  })

  it('handles async registered functions', async () => {
    register('asyncTask', async (x: unknown) => {
      return (x as number) * 2
    })
    const result = await run<number>('asyncTask', 5)
    expect(result).toBe(10)
  })

  it('rejects when the registered function throws', async () => {
    register('fail', () => {
      throw new Error('task error')
    })
    await expect(run('fail')).rejects.toThrow('task error')
  })

  it('passes multiple arguments', async () => {
    register('concat', (...args: unknown[]) => (args as string[]).join('-'))
    const result = await run<string>('concat', 'a', 'b', 'c')
    expect(result).toBe('a-b-c')
  })
})
