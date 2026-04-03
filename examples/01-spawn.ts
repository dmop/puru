/**
 * Example: spawn
 *
 * Use spawn() when you have a single CPU-intensive task to run off the main thread.
 * The task gets a dedicated worker thread — the main thread stays fully responsive.
 *
 * When to use spawn() vs alternatives:
 *   spawn(fn)                      — one CPU task, needs its own core
 *   spawn(fn, { concurrent: true }) — one async/I/O task, shares a thread
 *   WaitGroup / ErrGroup           — multiple tasks in parallel
 *
 * Spawn overhead is ~0.1–0.5ms. Only worth it for tasks >5ms of CPU work.
 * For trivial operations, just call them directly.
 *
 * IMPORTANT: Functions cannot capture variables from the enclosing scope.
 * All inputs must be inlined in the function body.
 */

import { spawn, configure } from '../dist/index.js'

configure({ adapter: 'auto' })

// ─── Basic: run a CPU task off the main thread ────────────────────────────────

{
  console.log('--- Basic CPU task ---')

  const { result } = spawn(() => {
    // Sieve of Eratosthenes — all primes up to 1M
    const N = 1_000_000
    const sieve = new Uint8Array(N + 1).fill(1)
    sieve[0] = sieve[1] = 0
    for (let i = 2; i * i <= N; i++) {
      if (sieve[i]) for (let j = i * i; j <= N; j += i) sieve[j] = 0
    }
    return sieve.reduce((n, v) => n + v, 0)
  })

  console.log(`Found ${await result} primes below 1,000,000`)
}

// ─── Concurrent mode: I/O-bound work sharing a thread ────────────────────────
//
// For async work (fetch, DB queries, file I/O), use concurrent: true.
// Many tasks share the thread's event loop — no thread-per-task overhead.

{
  console.log('\n--- Concurrent mode: async/I/O work ---')

  const { result } = spawn(
    async () => {
      // Simulate an async operation (DB query, external API call, etc.)
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
      return { status: 'ok', rows: 42 }
    },
    { concurrent: true },
  )

  const data = await result
  console.log(`Got response:`, data)
}

// ─── Cancellation ─────────────────────────────────────────────────────────────
//
// Call cancel() to abort a running task. The result promise rejects with AbortError.
// Useful for request timeouts, user-initiated cancels, or circuit breakers.

{
  console.log('\n--- Cancellation ---')

  const { result, cancel } = spawn(() => {
    // Long-running computation
    let n = 0
    for (let i = 0; i < 2e9; i++) n += i
    return n
  })

  // Cancel after 50ms
  const timer = setTimeout(cancel, 50)

  try {
    await result
    clearTimeout(timer)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.log('Task cancelled as expected')
    } else {
      throw err
    }
  }
}

// ─── Priority ─────────────────────────────────────────────────────────────────
//
// Tasks are dispatched in priority order: high → normal → low.
// Useful when the thread pool is saturated and you want critical work first.

{
  console.log('\n--- Priority scheduling ---')

  const low = spawn(() => 'low', { priority: 'low' })
  const normal = spawn(() => 'normal')
  const high = spawn(() => 'critical', { priority: 'high' })

  const results = await Promise.all([low.result, normal.result, high.result])
  console.log('Results:', results)
}
