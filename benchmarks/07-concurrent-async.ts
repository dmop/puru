/**
 * Benchmark: Concurrent Async Tasks
 *
 * Tests the thread pool with many concurrent async tasks sharing
 * few worker threads. Simulates I/O-bound workloads (like HTTP requests
 * or DB queries) by using setTimeout to mimic async wait times.
 *
 * Compares:
 *   1. Sequential (one at a time)
 *   2. Promise.all on main thread
 *   3. puru concurrent mode (off main thread)
 */

import { spawn, configure } from '../dist/index.js'
import { bench, report, detectRuntime } from './utils.js'

const NUM_TASKS = 100
const SIMULATED_IO_MS = 10 // simulate 10ms per "request"
const CPU_WORK_PER_TASK = 50_000 // some CPU work after "I/O"

function simulateIoTask(): Promise<number> {
  return new Promise(resolve => {
    setTimeout(() => {
      // CPU work after I/O completes
      let sum = 0
      for (let i = 0; i < CPU_WORK_PER_TASK; i++) sum += i
      resolve(sum)
    }, SIMULATED_IO_MS)
  })
}

async function main() {
  console.log(`Runtime: ${detectRuntime()}`)
  console.log(`${NUM_TASKS} async tasks, ${SIMULATED_IO_MS}ms simulated I/O each, ${CPU_WORK_PER_TASK} CPU ops after\n`)

  // --- Sequential ---
  const sequential = await bench('Sequential (one at a time)', async () => {
    const results: number[] = []
    for (let i = 0; i < NUM_TASKS; i++) {
      results.push(await simulateIoTask())
    }
    return results.length
  })

  // --- Promise.all on main thread ---
  const promiseAll = await bench('Promise.all (main thread)', async () => {
    const tasks = Array.from({ length: NUM_TASKS }, () => simulateIoTask())
    return (await Promise.all(tasks)).length
  })

  // --- puru concurrent mode (M:N) ---
  configure({ adapter: 'auto' })

  const concurrent = await bench('puru concurrent (M:N)', async () => {
    const handles = Array.from({ length: NUM_TASKS }, () =>
      spawn(async () => {
        return new Promise(resolve => {
          setTimeout(() => {
            let sum = 0
            for (let i = 0; i < 50000; i++) sum += i
            resolve(sum)
          }, 10)
        })
      }, { concurrent: true })
    )
    return (await Promise.all(handles.map(h => h.result))).length
  })

  report('M:N Concurrent Async — simulated I/O + CPU', [sequential, promiseAll, concurrent])
}

main().catch(console.error)
