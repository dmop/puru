/**
 * Benchmark: Mutex — serialized access under contention
 *
 * Measures the cost of Mutex.withLock when many concurrent tasks
 * compete for the same lock. Compares against unprotected access
 * (which would produce race conditions in real code).
 */

import { Mutex } from '../dist/index.js'
import { bench, report } from './utils.js'

async function main() {
  const TASKS = 1000
  const WORK_PER_TASK = 100

  // --- No lock (parallel, but racy) ---
  const noLock = await bench(`No lock (${TASKS} tasks)`, async () => {
    let counter = 0
    await Promise.all(
      Array.from({ length: TASKS }, async () => {
        for (let i = 0; i < WORK_PER_TASK; i++) {
          counter++
        }
      }),
    )
    return counter
  })

  // --- Mutex.withLock ---
  const withMutex = await bench(`Mutex.withLock (${TASKS} tasks)`, async () => {
    const mu = new Mutex()
    let counter = 0
    await Promise.all(
      Array.from({ length: TASKS }, () =>
        mu.withLock(async () => {
          for (let i = 0; i < WORK_PER_TASK; i++) {
            counter++
          }
        }),
      ),
    )
    return counter
  })

  // --- Manual lock/unlock ---
  const manual = await bench(`Mutex lock/unlock (${TASKS} tasks)`, async () => {
    const mu = new Mutex()
    let counter = 0
    await Promise.all(
      Array.from({ length: TASKS }, async () => {
        await mu.lock()
        try {
          for (let i = 0; i < WORK_PER_TASK; i++) {
            counter++
          }
        } finally {
          mu.unlock()
        }
      }),
    )
    return counter
  })

  report('Mutex contention — 1000 tasks competing for one lock', [
    noLock,
    withMutex,
    manual,
  ])
}

main().catch(console.error)
