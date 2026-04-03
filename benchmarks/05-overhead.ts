/**
 * Benchmark: Spawn Overhead (anti-pattern detector)
 *
 * Measures the cost of spawning a trivial task. This demonstrates when
 * puru is NOT worth using — if the task itself is faster than the
 * serialization + message passing + worker dispatch overhead.
 *
 * Rule of thumb: if your task takes < 1ms, don't use spawn().
 */

import { spawn, configure } from '../dist/index.js'
import { bench, report, detectRuntime } from './utils.js'

function trivialWork(): number {
  return 1 + 1
}

function lightWork(): number {
  let sum = 0
  for (let i = 0; i < 1000; i++) sum += i
  return sum
}

function mediumWork(): number {
  let sum = 0
  for (let i = 0; i < 1_000_000; i++) sum += i
  return sum
}

async function main() {
  console.log(`Runtime: ${detectRuntime()}`)
  console.log(`Measuring spawn overhead for various task sizes\n`)

  configure({ adapter: 'auto' })

  // --- Trivial task (1+1) ---
  const trivialDirect = await bench('Trivial: direct call', () => trivialWork())
  const trivialSpawn = await bench('Trivial: puru spawn', async () => {
    const { result } = spawn(() => 1 + 1)
    return result
  })

  report('Trivial task (1+1) — spawn overhead exposed', [trivialDirect, trivialSpawn])

  // --- Light task (1K iterations) ---
  const lightDirect = await bench('Light (1K iter): direct call', () => lightWork())
  const lightSpawned = await bench('Light (1K iter): puru spawn', async () => {
    const { result } = spawn(() => {
      let sum = 0
      for (let i = 0; i < 1000; i++) sum += i
      return sum
    })
    return result
  })

  report('Light task (1K iterations) — still too small for spawn', [lightDirect, lightSpawned])

  // --- Medium task (1M iterations) ---
  const mediumDirect = await bench('Medium (1M iter): direct call', () => mediumWork())
  const mediumSpawn = await bench('Medium (1M iter): puru spawn', async () => {
    const { result } = spawn(() => {
      let sum = 0
      for (let i = 0; i < 1_000_000; i++) sum += i
      return sum
    })
    return result
  })

  report('Medium task (1M iterations) — crossover point', [mediumDirect, mediumSpawn])
}

main().catch(console.error)
