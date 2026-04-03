/**
 * Example: configure, stats, resize
 *
 * configure() — set pool options before the first spawn. Call it at app startup.
 * stats()     — inspect the thread pool at runtime (workers, queue depth, throughput).
 * resize(n)   — scale the pool up or down while the app is running.
 *
 * When to call configure():
 *   ✓ At application startup, before any spawn/task calls
 *   ✓ In tests, to use the 'inline' adapter (no real workers)
 *   ✗ NOT after the first spawn() — it throws
 *
 * When to call stats():
 *   ✓ Health/readiness endpoints (/healthz)
 *   ✓ Metrics collection (Prometheus, Datadog)
 *   ✓ Debug logging under high load
 *
 * When to call resize():
 *   ✓ Scale up before a known batch job, back down after
 *   ✓ Dynamic scaling based on system load
 *   ✓ Reduce threads in response to memory pressure
 */

import { configure, stats, resize, WaitGroup } from '../dist/index.js'

// ─── configure: pool options ──────────────────────────────────────────────────
//
// All options have sensible defaults. You only need configure() if you want
// to override them.

configure({
  // maxThreads: os.availableParallelism() by default — usually the right choice
  maxThreads: 4,

  // concurrency: max async tasks per shared worker (default: 64)
  // Increase for high I/O parallelism, decrease to limit memory usage
  concurrency: 32,

  // idleTimeout: kill workers that have been idle for N ms (default: 30_000)
  // Lower for Lambda/serverless; higher for always-on services
  idleTimeout: 10_000,

  // adapter: 'auto' detects Node.js or Bun automatically (default)
  // Use 'inline' in tests to run tasks on the main thread (no real workers)
  adapter: 'auto',
})

// ─── stats: inspect the pool ─────────────────────────────────────────────────

{
  console.log('--- Pool stats at startup ---')

  const s = stats()
  console.log(`  maxThreads:   ${s.maxThreads}`)
  console.log(`  totalWorkers: ${s.totalWorkers} (0 until first task)`)
  console.log(`  queuedTasks:  ${s.queuedTasks.total}`)
}

// Run some tasks to warm up the pool
{
  const wg = new WaitGroup()
  for (let i = 0; i < 8; i++) {
    wg.spawn(() => {
      let x = 0
      for (let j = 0; j < 1e6; j++) x += j
      return x
    })
  }
  await wg.wait()
}

{
  console.log('\n--- Pool stats after batch job ---')

  const s = stats()
  console.log(`  totalWorkers:   ${s.totalWorkers}`)
  console.log(`  idleWorkers:    ${s.idleWorkers}`)
  console.log(`  busyWorkers:    ${s.busyWorkers}`)
  console.log(`  totalCompleted: ${s.totalCompleted}`)
  console.log(`  totalFailed:    ${s.totalFailed}`)
  console.log(`  queuedTasks:`)
  console.log(`    high:   ${s.queuedTasks.high}`)
  console.log(`    normal: ${s.queuedTasks.normal}`)
  console.log(`    low:    ${s.queuedTasks.low}`)
}

// ─── resize: scale the pool at runtime ───────────────────────────────────────
//
// Existing threads finish their current tasks before being shut down.
// New tasks are dispatched to the updated pool size.

{
  console.log('\n--- resize: scale pool dynamically ---')

  console.log(`  Before: maxThreads = ${stats().maxThreads}`)

  resize(2) // scale down — e.g., memory pressure, off-peak hours
  console.log(`  After scale-down: maxThreads = ${stats().maxThreads}`)

  resize(8) // scale up — e.g., before a batch job
  console.log(`  After scale-up: maxThreads = ${stats().maxThreads}`)

  resize(4) // restore default
  console.log(`  After restore: maxThreads = ${stats().maxThreads}`)
}

// ─── Testing: inline adapter ──────────────────────────────────────────────────
//
// In unit tests, use configure({ adapter: 'inline' }) so tasks run on the
// main thread. No real worker threads are created — tests run faster and
// errors have cleaner stack traces.
//
// Example (vitest / jest):
//
//   import { configure } from '@dmop/puru'
//
//   beforeAll(() => {
//     configure({ adapter: 'inline' })
//   })
//
//   it('processes data', async () => {
//     const result = await processData(fixtures.input)
//     expect(result).toEqual(fixtures.expected)
//   })

console.log('\n--- Testing: inline adapter (tasks run on main thread) ---')

// Can't call configure() again here since the pool is already initialized,
// but in a fresh test file, you'd call it before any spawn() calls.
console.log("  In tests, call configure({ adapter: 'inline' }) before any spawn()")
console.log('  This makes all tasks synchronous on the main thread — no real workers')
