/**
 * Example: RWMutex, Timer, Cond
 *
 * These are the newer synchronization primitives inspired by Go's sync package.
 *
 * RWMutex — multiple concurrent readers, exclusive writers (sync.RWMutex)
 * Timer   — resettable one-shot timer (time.Timer)
 * Cond    — condition variable with Wait/Signal/Broadcast (sync.Cond)
 *
 * When to use RWMutex:
 *   ✓ Read-heavy shared state (caches, config, lookup tables)
 *   ✓ Multiple readers need concurrent access
 *   ✓ Writes are infrequent but must be exclusive
 *
 * When to use Timer:
 *   ✓ Debounce — reset on every input, fire after silence
 *   ✓ Cancellable timeouts — stop if work finishes early
 *   ✓ Retry with adjustable delay — reset between attempts
 *
 * When to use Cond:
 *   ✓ Producer/consumer on the main thread
 *   ✓ Waiting for a condition to become true (queue non-empty, state ready)
 *   ✓ Broadcasting state changes to multiple waiters
 */

import { RWMutex, Timer, Cond, Mutex, select, after, configure } from '../dist/index.js'

configure({ adapter: 'auto' })

// ─── RWMutex: concurrent readers, exclusive writer ───────────────────────────
//
// Readers don't block each other. Writers wait for all readers to finish,
// then get exclusive access.

{
  console.log('--- RWMutex: concurrent config cache ---')

  const rw = new RWMutex()
  let config = { theme: 'light', lang: 'en' }

  // Simulate 5 concurrent readers
  const reads = Array.from({ length: 5 }, (_, i) =>
    rw.withRLock(async () => {
      // All 5 readers run concurrently — no blocking
      await new Promise<void>((r) => setTimeout(r, 10))
      return `reader-${i}: theme=${config.theme}`
    }),
  )

  const results = await Promise.all(reads)
  console.log(`  ${results.length} readers ran concurrently: ${results[0]}`)

  // Writer gets exclusive access
  await rw.withLock(async () => {
    config = { theme: 'dark', lang: 'en' }
  })

  const updated = await rw.withRLock(() => config.theme)
  console.log(`  After write: theme=${updated}`)
}

// ─── RWMutex: readers wait for writer ────────────────────────────────────────

{
  console.log('\n--- RWMutex: writer blocks readers ---')

  const rw = new RWMutex()
  const order: string[] = []

  // Take the write lock
  await rw.lock()

  // Queue some readers — they'll wait
  const readers = Promise.all(
    Array.from({ length: 3 }, (_, i) =>
      rw.withRLock(async () => {
        order.push(`read-${i}`)
      }),
    ),
  )

  // Readers are blocked — do the write
  order.push('write')
  rw.unlock()

  await readers
  console.log(`  Execution order: ${order.join(' → ')}`)
}

// ─── Timer: cancellable timeout ──────────────────────────────────────────────
//
// Unlike after(), Timer can be stopped if work finishes early.
// This avoids a dangling timer keeping the event loop alive.

{
  console.log('\n--- Timer: cancellable timeout with select ---')

  const t = new Timer(500)

  // Simulate work that finishes in 50ms
  const work = after(50).then(() => 'work done')

  let outcome = ''
  await select([
    [work, (v) => {
      t.stop() // cancel the timer — clean
      outcome = String(v)
    }],
    [t.channel, () => { outcome = 'timed out' }],
  ])

  console.log(`  Result: ${outcome} (timer stopped: ${t.stopped})`)
}

// ─── Timer: debounce pattern ─────────────────────────────────────────────────
//
// Reset the timer on every "event". The timer only fires after a period
// of silence — classic debounce without creating new objects.

{
  console.log('\n--- Timer: debounce ---')

  const t = new Timer(100)
  let events = 0

  // Simulate rapid events — each resets the timer
  for (let i = 0; i < 5; i++) {
    events++
    t.reset(100) // restart the 100ms window
    await after(30) // events arrive every 30ms
  }

  // Now wait for the timer to fire (100ms after last event)
  await t.channel
  console.log(`  Timer fired after ${events} events (debounced)`)
}

// ─── Cond: signal one waiter ─────────────────────────────────────────────────
//
// A producer sets data and signals one consumer to wake up.

{
  console.log('\n--- Cond: producer/consumer with signal ---')

  const mu = new Mutex()
  const cond = new Cond(mu)
  const queue: number[] = []

  // Consumer — waits for items
  const consumer = (async () => {
    await mu.lock()
    while (queue.length === 0) {
      await cond.wait() // releases lock, waits, re-acquires
    }
    const item = queue.shift()!
    mu.unlock()
    return item
  })()

  // Give consumer time to start waiting
  await after(10)

  // Producer — adds item and signals
  await mu.lock()
  queue.push(42)
  cond.signal() // wake one waiter
  mu.unlock()

  const received = await consumer
  console.log(`  Consumer received: ${received}`)
}

// ─── Cond: broadcast to all waiters ──────────────────────────────────────────
//
// Multiple waiters block until a condition is met.
// broadcast() wakes them all at once.

{
  console.log('\n--- Cond: broadcast to multiple waiters ---')

  const mu = new Mutex()
  const cond = new Cond(mu)
  let ready = false

  // 3 waiters — all block on the same condition
  const waiters = Array.from({ length: 3 }, (_, i) =>
    (async () => {
      await mu.lock()
      while (!ready) {
        await cond.wait()
      }
      mu.unlock()
      return `waiter-${i} woke up`
    })(),
  )

  await after(10)

  // Set the condition and wake everyone
  await mu.lock()
  ready = true
  cond.broadcast()
  mu.unlock()

  const results = await Promise.all(waiters)
  console.log(`  ${results.join(', ')}`)
}
