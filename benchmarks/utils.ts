export interface BenchResult {
  name: string
  timeMs: number
  memoryMb: number
  result?: unknown
}

export async function bench(name: string, fn: () => Promise<unknown> | unknown): Promise<BenchResult> {
  // Warmup
  await fn()

  const runs = 5
  const times: number[] = []
  const memories: number[] = []
  let lastResult: unknown

  for (let i = 0; i < runs; i++) {
    if (globalThis.gc) globalThis.gc()
    const memBefore = process.memoryUsage.rss()
    const start = performance.now()
    lastResult = await fn()
    times.push(performance.now() - start)
    const memAfter = process.memoryUsage.rss()
    memories.push(Math.max(0, memAfter - memBefore))
  }

  // Median time
  times.sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]

  // Median memory
  memories.sort((a, b) => a - b)
  const medianMem = memories[Math.floor(memories.length / 2)]
  const memoryMb = Math.round((medianMem / 1024 / 1024) * 100) / 100

  return { name, timeMs: Math.round(median * 100) / 100, memoryMb, result: lastResult }
}

export function report(title: string, results: BenchResult[]) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`  ${title}`)
  console.log('='.repeat(60))

  const baseline = results[0].timeMs || 0.001 // avoid division by zero

  for (const r of results) {
    const ratio = r.timeMs / baseline
    const speedup = ratio < 1 ? `${(1 / ratio).toFixed(2)}x faster` : ratio > 1 && isFinite(ratio) ? `${ratio.toFixed(2)}x slower` : ratio > 1 ? 'much slower (task too trivial)' : 'baseline'
    const tag = r === results[0] ? '(baseline)' : speedup
    const mem = `${r.memoryMb} MB`
    console.log(`  ${r.name.padEnd(35)} ${String(r.timeMs + 'ms').padStart(10)}  ${mem.padStart(10)}  ${tag}`)
  }

  console.log()
}

export function detectRuntime(): string {
  if (typeof Bun !== 'undefined') return 'bun'
  return 'node'
}
