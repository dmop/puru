import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn, resetTaskCounter } from '../src/spawn.js'
import { stats, resetPool } from '../src/pool.js'
import { resetConfig, configure } from '../src/configure.js'

describe('stats', () => {
  beforeEach(() => {
    resetConfig()
    configure({ maxThreads: 2, idleTimeout: 1000 })
  })

  afterEach(async () => {
    await resetPool()
    resetTaskCounter()
  })

  it('reports initial stats', () => {
    const s = stats()
    expect(s.maxThreads).toBe(2)
    expect(s.totalCompleted).toBe(0)
    expect(s.totalFailed).toBe(0)
  })

  it('tracks completed tasks', async () => {
    await spawn(() => 1).result
    await spawn(() => 2).result
    const s = stats()
    expect(s.totalCompleted).toBe(2)
    expect(s.totalFailed).toBe(0)
  })

  it('tracks failed tasks', async () => {
    try {
      await spawn(() => { throw new Error('fail') }).result
    } catch {}
    const s = stats()
    expect(s.totalFailed).toBe(1)
  })

  it('reports worker counts after task completes', async () => {
    await spawn(() => 1).result
    const s = stats()
    expect(s.totalWorkers).toBeGreaterThanOrEqual(1)
    expect(s.totalCompleted).toBeGreaterThanOrEqual(1)
  })
})
