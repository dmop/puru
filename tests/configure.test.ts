import { describe, it, expect, beforeEach } from 'vitest'
import { configure, getConfig, resetConfig } from '../src/configure.js'

describe('configure', () => {
  beforeEach(() => {
    resetConfig()
  })

  it('returns default config', () => {
    const config = getConfig()
    expect(config.strategy).toBe('fifo')
    expect(config.idleTimeout).toBe(30_000)
    expect(config.maxThreads).toBeGreaterThan(0)
  })

  it('allows overriding config', () => {
    configure({ maxThreads: 2, idleTimeout: 5000 })
    const config = getConfig()
    expect(config.maxThreads).toBe(2)
    expect(config.idleTimeout).toBe(5000)
    expect(config.strategy).toBe('fifo')
  })

  it('throws if configure is called after getConfig', () => {
    getConfig() // locks config
    expect(() => configure({ maxThreads: 1 })).toThrow(
      'configure() must be called before the first spawn()',
    )
  })

  it('allows multiple configure calls before lock', () => {
    configure({ maxThreads: 2 })
    configure({ maxThreads: 4 })
    const config = getConfig()
    expect(config.maxThreads).toBe(4)
  })

  it('returns a copy, not the original', () => {
    const config1 = getConfig()
    const config2 = getConfig()
    expect(config1).toEqual(config2)
    expect(config1).not.toBe(config2)
  })
})
