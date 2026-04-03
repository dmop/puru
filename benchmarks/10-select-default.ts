/**
 * Benchmark: select() with default — non-blocking select
 *
 * Measures the overhead of non-blocking select (with default case)
 * vs blocking select. Non-blocking select should return immediately
 * when no channel is ready.
 */

import { chan, select, after } from '../dist/index.js'
import { bench, report } from './utils.js'

async function main() {
  const ITERATIONS = 10_000

  // --- Non-blocking select with default (try-recv pattern) ---
  const nonBlocking = await bench(
    `Non-blocking select x${ITERATIONS}`,
    async () => {
      const ch = chan<number>(1)
      let hits = 0
      let misses = 0

      // Pre-fill channel for half the iterations
      for (let i = 0; i < ITERATIONS / 2; i++) {
        await ch.send(i)
        // Drain immediately so channel stays at 0-1 items
        await select(
          [[ch.recv(), () => hits++]],
          { default: () => misses++ },
        )
      }

      // Now do iterations on empty channel — should all hit default
      for (let i = 0; i < ITERATIONS / 2; i++) {
        await select(
          [[ch.recv(), () => hits++]],
          { default: () => misses++ },
        )
      }

      return { hits, misses }
    },
  )

  // --- Blocking select with immediate resolve ---
  const blocking = await bench(
    `Blocking select x${ITERATIONS}`,
    async () => {
      let count = 0
      for (let i = 0; i < ITERATIONS; i++) {
        await select([
          [Promise.resolve(i), () => count++],
        ])
      }
      return count
    },
  )

  report('select() — blocking vs non-blocking (default case)', [
    blocking,
    nonBlocking,
  ])
}

main().catch(console.error)
