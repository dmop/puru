/**
 * Benchmark: Once and Ticker primitives
 *
 * Measures Once.do() under concurrent pressure (only first call
 * should execute), and Ticker throughput.
 */

import { Once, ticker } from '../dist/index.js'
import { bench, report } from './utils.js'

async function main() {
  // --- Once: concurrent calls ---
  const CONCURRENT = 10_000

  const onceBench = await bench(
    `Once.do() x${CONCURRENT} concurrent`,
    async () => {
      let callCount = 0
      const once = new Once<number>()
      const results = await Promise.all(
        Array.from({ length: CONCURRENT }, () =>
          once.do(() => {
            callCount++
            return 42
          }),
        ),
      )
      return { callCount, uniqueResults: new Set(results).size }
    },
  )

  const directBench = await bench(
    `Direct lazy init x${CONCURRENT} concurrent`,
    async () => {
      let callCount = 0
      let cached: number | null = null
      const results = await Promise.all(
        Array.from({ length: CONCURRENT }, async () => {
          if (cached === null) {
            callCount++
            cached = 42
          }
          return cached
        }),
      )
      return { callCount, uniqueResults: new Set(results).size }
    },
  )

  report('Once — concurrent initialization', [directBench, onceBench])

  // --- Ticker: throughput ---
  const TICKS = 20

  const tickerBench = await bench(`Ticker (${TICKS} ticks, 10ms)`, async () => {
    const t = ticker(10)
    let count = 0
    for await (const _ of t) {
      count++
      if (count >= TICKS) t.stop()
    }
    return count
  })

  const intervalBench = await bench(
    `setInterval (${TICKS} ticks, 10ms)`,
    async () => {
      return new Promise<number>((resolve) => {
        let count = 0
        const id = setInterval(() => {
          count++
          if (count >= TICKS) {
            clearInterval(id)
            resolve(count)
          }
        }, 10)
      })
    },
  )

  report('Ticker vs setInterval — 20 ticks at 10ms', [intervalBench, tickerBench])
}

main().catch(console.error)
