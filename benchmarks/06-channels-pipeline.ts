/**
 * Benchmark: Channel Pipeline with Fan-Out
 *
 * Tests channels-in-workers with a fan-out pattern:
 *   1 Producer → N Transform workers → 1 Consumer (main thread)
 *
 * Each transform worker pulls from the same input channel
 * and pushes results to a shared output channel. This is
 * the Go-style "worker pool" pattern with channels.
 */

import { spawn, chan, configure } from '../dist/index.js'
import { bench, report, detectRuntime } from './utils.js'

const ITEMS = 200
const CPU_OPS = 100_000
const NUM_TRANSFORM_WORKERS = 4

function processItem(seed: number): number {
  let hash = seed
  for (let i = 0; i < CPU_OPS; i++) {
    hash = ((hash << 5) - hash + i) | 0
  }
  return hash
}

async function main() {
  console.log(`Runtime: ${detectRuntime()}`)
  console.log(`Pipeline: ${ITEMS} items, ${CPU_OPS} ops/item, ${NUM_TRANSFORM_WORKERS} transform workers\n`)

  // --- Sequential (single thread, no channels) ---
  const sequential = await bench('Sequential (no channels)', () => {
    const results: number[] = []
    for (let i = 0; i < ITEMS; i++) {
      results.push(processItem(i * 7 + 13))
    }
    return results.length
  })

  // --- puru fan-out pipeline ---
  configure({ adapter: 'auto' })

  const fanout = await bench('puru fan-out pipeline', async () => {
    const input = chan<number>(50)
    const output = chan<number>(50)

    // Producer: push items into input channel
    spawn(async ({ out }) => {
      for (let i = 0; i < 200; i++) {
        await out.send(i * 7 + 13)
      }
      out.close()
    }, { channels: { out: input }, concurrent: true })

    // N transform workers: pull from input, push to output
    let doneCount = 0
    for (let w = 0; w < NUM_TRANSFORM_WORKERS; w++) {
      spawn(async ({ input, output }) => {
        for await (const raw of input) {
          let hash = raw as number
          for (let i = 0; i < 100000; i++) {
            hash = ((hash << 5) - hash + i) | 0
          }
          await output.send(hash)
        }
      }, { channels: { input, output } })
    }

    // Consumer: collect results on main thread
    // We know exactly how many items to expect
    const results: number[] = []
    for (let i = 0; i < ITEMS; i++) {
      const v = await output.recv()
      if (v === null) break
      results.push(v)
    }
    return results.length
  })

  // --- Main-thread only (no workers, no parallelism) ---
  const mainThread = await bench('Main-thread channels only', async () => {
    const input = chan<number>(50)
    const output = chan<number>(50)

    ;(async () => {
      for (let i = 0; i < ITEMS; i++) await input.send(i * 7 + 13)
      input.close()
    })()

    ;(async () => {
      for await (const raw of input) {
        await output.send(processItem(raw))
      }
      output.close()
    })()

    const results: number[] = []
    for await (const v of output) results.push(v)
    return results.length
  })

  report('Channel Fan-Out Pipeline — 1 producer → N workers → 1 consumer', [sequential, fanout, mainThread])
}

main().catch(console.error)
