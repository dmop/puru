/**
 * Example: WaitGroup
 *
 * Use WaitGroup when you have N independent tasks to run in parallel
 * and need to wait for ALL of them to finish.
 *
 * Choosing between WaitGroup methods:
 *   wg.wait()        — like Promise.all()        — throws on first error, others keep running
 *   wg.waitSettled() — like Promise.allSettled()  — waits for all, never throws
 *
 * Choosing between WaitGroup and ErrGroup:
 *   WaitGroup — tasks are independent; partial failures are acceptable
 *   ErrGroup  — ALL tasks must succeed; one failure should cancel the rest
 *
 * See 03-errgroup.ts for the ErrGroup pattern.
 */

import { WaitGroup, configure } from '../dist/index.js'

configure({ adapter: 'auto' })

type EndpointResult = {
  id: number
  latency: number
  data: string
}

// ─── CPU-bound fan-out ────────────────────────────────────────────────────────
//
// Split a large dataset across workers. Each worker gets a chunk.
// WaitGroup collects all results.

{
  console.log('--- CPU fan-out: count words in document chunks ---')

  const documents = [
    'the quick brown fox jumps over the lazy dog',
    'pack my box with five dozen liquor jugs',
    'how vexingly quick daft zebras jump',
    'sphinx of black quartz judge my vow',
    'the five boxing wizards jump quickly',
  ]

  const wg = new WaitGroup()

  for (const doc of documents) {
    wg.spawn(() => {
      // Inline the data — functions cannot capture from outer scope
      const text = 'REPLACED_AT_RUNTIME'
      void text // silence unused warning
      const words = doc.split(' ')
      return { words: words.length, unique: new Set(words).size }
    })
  }

  // Use waitSettled() — even if one doc fails, we get the rest
  const settled = await wg.waitSettled()

  for (const [i, r] of settled.entries()) {
    if (r.status === 'fulfilled') {
      const { words, unique } = r.value as { words: number; unique: number }
      console.log(`  Doc ${i + 1}: ${words} words, ${unique} unique`)
    } else {
      console.error(`  Doc ${i + 1}: failed — ${r.reason}`)
    }
  }
}

// ─── I/O-bound fan-out (concurrent mode) ─────────────────────────────────────
//
// For async tasks (HTTP requests, DB queries, file reads), use concurrent: true.
// All tasks run on shared threads — no thread-per-request overhead.
// The main thread stays unblocked the entire time.

{
  console.log('\n--- I/O fan-out: parallel simulated API calls ---')

  const endpoints = [
    { id: 1, delay: 30 },
    { id: 2, delay: 10 },
    { id: 3, delay: 50 },
    { id: 4, delay: 20 },
    { id: 5, delay: 40 },
  ]

  const wg = new WaitGroup()
  const start = Date.now()

  for (const { id, delay } of endpoints) {
    wg.spawn(
      async () => {
        // Simulate network latency
        await new Promise<void>((r) => setTimeout(r, delay))
        return { id, latency: delay, data: `response from endpoint ${id}` }
      },
      { concurrent: true },
    )
  }

  const results = await wg.wait()
  const elapsed = Date.now() - start

  console.log(`  ${results.length} responses in ${elapsed}ms (longest was 50ms — ran in parallel)`)
  for (const r of results as EndpointResult[]) {
    console.log(`  Endpoint ${r.id}: ${r.latency}ms`)
  }
}

// ─── Cancellation ─────────────────────────────────────────────────────────────
//
// wg.cancel() aborts all tasks that haven't completed yet.
// Useful for implementing request timeouts.

{
  console.log('\n--- Cancellation: stop all tasks after timeout ---')

  const wg = new WaitGroup()

  for (let i = 0; i < 5; i++) {
    wg.spawn(
      async () => {
        const duration = (i + 1) * 200
        await new Promise<void>((r) => setTimeout(r, duration))
        return `task ${i + 1} done`
      },
      { concurrent: true },
    )
  }

  // Cancel all after 350ms — tasks 1 and 2 should complete, rest cancelled
  setTimeout(() => wg.cancel(), 350)

  const settled = await wg.waitSettled()
  const done = settled.filter((r) => r.status === 'fulfilled').length
  const cancelled = settled.filter((r) => r.status === 'rejected').length
  console.log(`  ${done} completed, ${cancelled} cancelled`)
}
