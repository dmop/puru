/**
 * Benchmark: Recursive Fibonacci
 *
 * Tests CPU-bound recursive computation. This is a classic case where
 * parallelism shines — multiple independent fibonacci computations can
 * run simultaneously across worker threads.
 *
 * We compute fib(N) for several values in parallel vs sequentially.
 */

import { spawn, configure } from '../dist/index.js'
import { bench, report, detectRuntime } from './utils.js'

// Intentionally naive recursive fib — the point is to burn CPU
function fib(n: number): number {
  if (n <= 1) return n
  return fib(n - 1) + fib(n - 2)
}

const FIB_N = 38 // ~1-2 seconds per call
const TASKS = 8  // number of parallel tasks

async function main() {
  console.log(`Runtime: ${detectRuntime()}`)
  console.log(`Computing fib(${FIB_N}) x${TASKS} tasks\n`)

  // --- Sequential (single thread) ---
  const sequential = await bench(`${detectRuntime()} (without puru)`, () => {
    const results: number[] = []
    for (let i = 0; i < TASKS; i++) {
      results.push(fib(FIB_N))
    }
    return results
  })

  // --- puru (worker threads) ---
  configure({ adapter: 'auto' })

  const parallel = await bench(`${detectRuntime()} (with puru)`, async () => {
    const fibFn = new Function(`
      function fib(n) {
        if (n <= 1) return n;
        return fib(n - 1) + fib(n - 2);
      }
      return fib(38);
    `) as () => number
    const handles = Array.from({ length: TASKS }, () => spawn(fibFn))
    return Promise.all(handles.map(h => h.result))
  })

  report('Fibonacci — CPU-bound recursive computation', [sequential, parallel])
}

main().catch(console.error)
