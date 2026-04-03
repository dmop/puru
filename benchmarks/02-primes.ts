/**
 * Benchmark: Prime Number Counting
 *
 * Counts primes up to N using trial division. This is a CPU-intensive
 * task that's trivially parallelizable by splitting the range into chunks.
 *
 * Demonstrates the "split range across workers" pattern.
 */

import { spawn, configure } from '../dist/index.js'
import { bench, report, detectRuntime } from './utils.js'

function countPrimesInRange(from: number, to: number): number {
  let count = 0
  for (let n = from; n <= to; n++) {
    if (n < 2) continue
    let isPrime = true
    for (let i = 2; i * i <= n; i++) {
      if (n % i === 0) { isPrime = false; break }
    }
    if (isPrime) count++
  }
  return count
}

const LIMIT = 2_000_000
const NUM_WORKERS = 8

async function main() {
  console.log(`Runtime: ${detectRuntime()}`)
  console.log(`Counting primes up to ${LIMIT.toLocaleString()}\n`)

  // --- Sequential ---
  const sequential = await bench(`${detectRuntime()} (without puru)`, () => {
    return countPrimesInRange(2, LIMIT)
  })

  // --- puru parallel (split range) ---
  configure({ adapter: 'auto' })

  const parallel = await bench(`${detectRuntime()} (with puru)`, async () => {
    const chunkSize = Math.ceil(LIMIT / NUM_WORKERS)
    const handles = Array.from({ length: NUM_WORKERS }, (_, i) => {
      const rangeFrom = i * chunkSize + 1
      const rangeTo = Math.min((i + 1) * chunkSize, LIMIT)
      const fn = new Function(`
        const from = ${rangeFrom};
        const to = ${rangeTo};
        let count = 0;
        for (let n = from; n <= to; n++) {
          if (n < 2) continue;
          let isPrime = true;
          for (let i = 2; i * i <= n; i++) {
            if (n % i === 0) { isPrime = false; break; }
          }
          if (isPrime) count++;
        }
        return count;
      `) as () => number
      return spawn(fn)
    })
    const counts = await Promise.all(handles.map(h => h.result))
    return (counts as number[]).reduce((a, b) => a + b, 0)
  })

  report('Primes — CPU-bound range splitting', [sequential, parallel])
}

main().catch(console.error)
