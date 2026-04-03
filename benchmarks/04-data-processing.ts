/**
 * Benchmark: Heavy Data Processing / Hashing Simulation
 *
 * Simulates CPU-heavy data transformation: generating large arrays,
 * sorting, computing checksums, and aggregating. This mimics real-world
 * scenarios like log processing, CSV parsing, or report generation
 * where each chunk can be processed independently.
 */

import { spawn, configure } from '../dist/index.js'
import { bench, report, detectRuntime } from './utils.js'

function processChunk(chunkId: number, size: number): { chunkId: number; checksum: number; sorted: number } {
  // Generate pseudo-random data
  const data: number[] = []
  let seed = chunkId * 1000 + 7
  for (let i = 0; i < size; i++) {
    seed = (seed * 16807 + 12345) & 0x7fffffff
    data.push(seed)
  }

  // Sort it
  data.sort((a, b) => a - b)

  // Compute a checksum (simulate hashing)
  let checksum = 0
  for (let i = 0; i < data.length; i++) {
    checksum = ((checksum << 5) - checksum + data[i]) | 0
  }

  // Count inversions (extra CPU work)
  let inversions = 0
  for (let i = 0; i < Math.min(data.length, 2000); i++) {
    for (let j = i + 1; j < Math.min(data.length, 2000); j++) {
      if (data[i] > data[j]) inversions++
    }
  }

  return { chunkId, checksum, sorted: inversions }
}

const CHUNK_SIZE = 100_000
const NUM_CHUNKS = 8

async function main() {
  console.log(`Runtime: ${detectRuntime()}`)
  console.log(`Processing ${NUM_CHUNKS} chunks of ${CHUNK_SIZE.toLocaleString()} items each\n`)

  // --- Sequential ---
  const sequential = await bench(`${detectRuntime()} (without puru)`, () => {
    const results = []
    for (let i = 0; i < NUM_CHUNKS; i++) {
      results.push(processChunk(i, CHUNK_SIZE))
    }
    return results.length
  })

  // --- puru parallel ---
  configure({ adapter: 'auto' })

  const parallel = await bench(`${detectRuntime()} (with puru)`, async () => {
    const handles = Array.from({ length: NUM_CHUNKS }, (_, i) => {
      const chunkId = i
      const size = CHUNK_SIZE
      const fn = new Function(`
        const chunkId = ${chunkId};
        const size = ${size};
        const data = [];
        let seed = chunkId * 1000 + 7;
        for (let i = 0; i < size; i++) {
          seed = (seed * 16807 + 12345) & 0x7fffffff;
          data.push(seed);
        }
        data.sort((a, b) => a - b);
        let checksum = 0;
        for (let i = 0; i < data.length; i++) {
          checksum = ((checksum << 5) - checksum + data[i]) | 0;
        }
        let inversions = 0;
        for (let i = 0; i < Math.min(data.length, 2000); i++) {
          for (let j = i + 1; j < Math.min(data.length, 2000); j++) {
            if (data[i] > data[j]) inversions++;
          }
        }
        return { chunkId, checksum, sorted: inversions };
      `) as () => unknown
      return spawn(fn)
    })
    return (await Promise.all(handles.map(h => h.result))).length
  })

  report('Data Processing — sort + checksum + aggregation', [sequential, parallel])
}

main().catch(console.error)
