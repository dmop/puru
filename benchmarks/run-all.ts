/**
 * Run all benchmarks sequentially.
 * Usage:
 *   npx tsx benchmarks/run-all.ts
 *   bun benchmarks/run-all.ts
 */

import { execSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const runner = typeof Bun !== 'undefined' ? 'bun' : 'npx tsx'

const benchFiles = readdirSync(__dirname)
  .filter(f => /^\d{2}-.*\.ts$/.test(f))
  .sort()

console.log('╔════════════════════════════════════════════════════════════╗')
console.log('║              puru Benchmark Suite                        ║')
console.log(`║              Runtime: ${runner.padEnd(37)}║`)
console.log('╚════════════════════════════════════════════════════════════╝')

for (const file of benchFiles) {
  console.log(`\n▸ Running ${file}...`)
  try {
    execSync(`${runner} ${join(__dirname, file)}`, {
      stdio: 'inherit',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    })
  } catch {
    console.error(`  ✗ ${file} failed`)
  }
}

console.log('\n Done.')
