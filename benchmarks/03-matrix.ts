/**
 * Benchmark: Matrix Multiplication
 *
 * Multiplies NxN matrices. Each matrix multiplication is independent,
 * so we can run several in parallel. This simulates workloads like
 * image processing, physics simulations, or ML inference.
 */

import { spawn, configure } from '../dist/index.js'
import { bench, report, detectRuntime } from './utils.js'

function multiplyMatrices(size: number): number[][] {
  // Create two random-ish matrices (deterministic for reproducibility)
  const a: number[][] = []
  const b: number[][] = []
  for (let i = 0; i < size; i++) {
    a[i] = []
    b[i] = []
    for (let j = 0; j < size; j++) {
      a[i][j] = (i * size + j) % 97
      b[i][j] = (j * size + i) % 89
    }
  }

  // Standard O(n³) multiplication
  const result: number[][] = []
  for (let i = 0; i < size; i++) {
    result[i] = []
    for (let j = 0; j < size; j++) {
      let sum = 0
      for (let k = 0; k < size; k++) {
        sum += a[i][k] * b[k][j]
      }
      result[i][j] = sum
    }
  }
  return result
}

const MATRIX_SIZE = 200
const TASKS = 8

async function main() {
  console.log(`Runtime: ${detectRuntime()}`)
  console.log(`Matrix multiply ${MATRIX_SIZE}x${MATRIX_SIZE}, ${TASKS} independent multiplications\n`)

  // --- Sequential ---
  const sequential = await bench(`${detectRuntime()} (without puru)`, () => {
    const results = []
    for (let t = 0; t < TASKS; t++) {
      results.push(multiplyMatrices(MATRIX_SIZE))
    }
    return results.length
  })

  // --- puru parallel ---
  configure({ adapter: 'auto' })

  const parallel = await bench(`${detectRuntime()} (with puru)`, async () => {
    const handles = Array.from({ length: TASKS }, () =>
      spawn(() => {
        const size = 200
        const a: number[][] = []
        const b: number[][] = []
        for (let i = 0; i < size; i++) {
          a[i] = []
          b[i] = []
          for (let j = 0; j < size; j++) {
            a[i][j] = (i * size + j) % 97
            b[i][j] = (j * size + i) % 89
          }
        }
        const result: number[][] = []
        for (let i = 0; i < size; i++) {
          result[i] = []
          for (let j = 0; j < size; j++) {
            let sum = 0
            for (let k = 0; k < size; k++) {
              sum += a[i][k] * b[k][j]
            }
            result[i][j] = sum
          }
        }
        return result.length
      })
    )
    return (await Promise.all(handles.map(h => h.result))).length
  })

  report('Matrix Multiply — CPU-bound batch computation', [sequential, parallel])
}

main().catch(console.error)
