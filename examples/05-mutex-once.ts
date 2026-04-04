/**
 * Example: Mutex and Once
 *
 * Mutex   — serialize access to a shared resource under concurrency.
 * RWMutex — like Mutex, but allows concurrent readers (see example 15).
 * Once    — initialize something exactly once, even under concurrent calls.
 *
 * When to use Mutex:
 *   ✓ Multiple async tasks writing to a shared counter / state
 *   ✓ Protecting a non-atomic read-modify-write operation
 *   ✓ Serializing writes to a shared file or DB connection
 *
 * When to use RWMutex instead of Mutex:
 *   ✓ Read-heavy workloads — many readers, few writers
 *   ✓ Config caches, lookup tables, shared state that's mostly read
 *
 * When NOT to use Mutex:
 *   ✗ Protecting reads only (reads are already safe without locks)
 *   ✗ Coordinating ACROSS worker threads — Mutex only works within the same thread
 *     (use channels for cross-thread coordination)
 *
 * When to use Once:
 *   ✓ Lazy initialization of an expensive singleton (DB pool, config, cache)
 *   ✓ Ensuring one-time setup even when many tasks start concurrently
 */

import { Mutex, Once, WaitGroup, configure } from '../dist/index.js'

configure({ adapter: 'auto' })

// ─── Mutex: protect a shared counter ──────────────────────────────────────────
//
// Without a mutex, concurrent read-modify-write leads to a race condition.
// With withLock(), the critical section is serialized.

{
  console.log('--- Mutex: concurrent counter (no race conditions) ---')

  const mu = new Mutex()
  let counter = 0

  const wg = new WaitGroup()

  for (let i = 0; i < 100; i++) {
    wg.spawn(
      async () => {
        // withLock() auto-releases even if the function throws
        await mu.withLock(async () => {
          const current = counter
          await new Promise<void>((r) => setTimeout(r, 0)) // yield
          counter = current + 1
        })
      },
      { concurrent: true },
    )
  }

  await wg.wait()
  console.log(`  Counter = ${counter} (expected 100)`)
}

// ─── Mutex: manual lock/unlock ────────────────────────────────────────────────
//
// Use manual lock when you need to hold the lock across multiple await points
// and want fine-grained control. Always use try/finally to prevent deadlocks.

{
  console.log('\n--- Mutex: manual lock/unlock with try/finally ---')

  const mu = new Mutex()
  const log: string[] = []

  async function writeToLog(entry: string) {
    await mu.lock()
    try {
      // Critical section: read + append + write
      log.push(`[${log.length}] ${entry}`)
      await new Promise<void>((r) => setTimeout(r, 5)) // simulate async write
    } finally {
      mu.unlock() // always unlocks, even on error
    }
  }

  await Promise.all([
    writeToLog('first entry'),
    writeToLog('second entry'),
    writeToLog('third entry'),
  ])

  console.log('  Log entries (serialized):')
  for (const entry of log) console.log(`    ${entry}`)
}

// ─── Once: lazy initialization ────────────────────────────────────────────────
//
// Once ensures the function runs exactly once, regardless of how many
// callers invoke it concurrently. All callers get the same cached result.

{
  console.log('\n--- Once: lazy singleton initialization ---')

  let initCount = 0

  const dbConnection = new Once<{ host: string; connected: boolean }>()

  async function getDb() {
    return dbConnection.do(async () => {
      initCount++
      console.log(`  [initializing DB connection — call #${initCount}]`)
      await new Promise<void>((r) => setTimeout(r, 50)) // simulate async connect
      return { host: 'localhost:5432', connected: true }
    })
  }

  // Simulate 10 concurrent callers all needing the DB
  const connections = await Promise.all(Array.from({ length: 10 }, () => getDb()))

  console.log(`  DB initialized ${initCount} time(s) despite ${connections.length} concurrent calls`)
  console.log(`  All callers got same object: ${connections.every((c) => c === connections[0])}`)
}

// ─── Once: reset for re-initialization ───────────────────────────────────────
//
// Call once.reset() to clear the cached result — useful for testing
// or when you need to re-connect after a failure.

{
  console.log('\n--- Once: reset for re-initialization ---')

  let callCount = 0
  const serviceInit = new Once<string>()

  const first = await serviceInit.do(async () => {
    callCount++
    return `connection-${callCount}`
  })

  console.log(`  First call: ${first}, done=${serviceInit.done}`)

  serviceInit.reset() // clear cached result
  console.log(`  After reset: done=${serviceInit.done}`)

  const second = await serviceInit.do(async () => {
    callCount++
    return `connection-${callCount}`
  })

  console.log(`  Second call after reset: ${second}`)
}
