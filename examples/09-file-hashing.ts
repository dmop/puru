/**
 * Example: Parallel File Hashing
 *
 * Hash every source file in a directory across worker threads.
 * Each worker uses Node's crypto module — genuinely CPU-bound work
 * that benefits from parallelism on multi-core machines.
 *
 * Primitives used: task(), WaitGroup
 */

import { task, configure } from '../dist/index.js'
import fs from 'node:fs'
import path from 'node:path'

configure({ adapter: 'auto' })

// ─── Define a reusable hashing task ──────────────────────────────────────────
//
// task() creates a typed, reusable function that runs in the thread pool.
// Inside the worker, we use require() to access Node built-ins.

const hashFile = task((filePath: string, algorithm: string) => {
  const crypto = require('node:crypto')
  const fs = require('node:fs')
  const data = fs.readFileSync(filePath)
  const hash = crypto.createHash(algorithm).update(data).digest('hex')
  return { file: filePath, hash, bytes: data.length }
})

// ─── Discover files ──────────────────────────────────��───────────────────────

const srcDir = path.resolve(import.meta.dirname, '..', 'src')
const files = fs.readdirSync(srcDir, { recursive: true })
  .map((f) => path.join(srcDir, String(f)))
  .filter((f) => f.endsWith('.ts') && fs.statSync(f).isFile())

console.log(`Hashing ${files.length} files in src/ with SHA-256...\n`)

// ─── Hash all files in parallel ──────────────────────────────────────────────
//
// Each call to hashFile() dispatches to the thread pool.
// Promise.all() waits for all workers to finish.

const start = performance.now()

const results = await Promise.all(
  files.map((f) => hashFile(f, 'sha256')),
)

const elapsed = (performance.now() - start).toFixed(1)

// ─── Print results ───────────────────────────────────────────────────────────

let totalBytes = 0
for (const { file, hash, bytes } of results) {
  const relative = path.relative(srcDir, file)
  console.log(`  ${hash.slice(0, 12)}…  ${relative} (${bytes} bytes)`)
  totalBytes += bytes
}

console.log(`\nHashed ${results.length} files (${totalBytes} bytes) in ${elapsed}ms`)

// ─── Fault-tolerant batch with Promise.allSettled ────────────────────────────
//
// If some files might be unreadable, use allSettled() to get partial results
// instead of failing on the first error.

{
  console.log('\n--- Fault-tolerant: handle missing files gracefully ---')

  // Mix valid files with a bad path
  const mixedPaths = [...files.slice(0, 3), '/nonexistent/file.ts']

  const settled = await Promise.allSettled(
    mixedPaths.map((f) => hashFile(f, 'sha256')),
  )

  const succeeded = settled.filter((r) => r.status === 'fulfilled').length
  const failed = settled.filter((r) => r.status === 'rejected').length

  console.log(`  ${succeeded} succeeded, ${failed} failed`)
}
