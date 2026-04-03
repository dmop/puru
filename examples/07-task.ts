/**
 * Example: task()
 *
 * task() creates a reusable worker-thread function with typed arguments.
 * Define it once, call it many times with different inputs.
 *
 * When to use task() vs spawn():
 *   task()   — same function called repeatedly with different args
 *              (image resizing, data transforms, report generation)
 *   spawn()  — one-off work with logic inlined at the call site
 *
 * task() dispatches to the thread pool on every call, just like spawn().
 * The difference is ergonomics: task() gives you a named, typed, reusable function.
 *
 * IMPORTANT: The function passed to task() cannot capture variables from
 * the enclosing scope. Arguments are passed explicitly and must be
 * JSON-serializable (no functions, Buffers that need to stay typed, symbols, etc.).
 */

import { task, WaitGroup, configure } from '../dist/index.js'

configure({ adapter: 'auto' })

// ─── Define reusable tasks ────────────────────────────────────────────────────

// Simulates image processing (e.g., resize + compress)
const processImage = task((src: string, width: number, height: number) => {
  // In production: call sharp(src).resize(width, height).toBuffer()
  // Here: simulate CPU work
  let checksum = 0
  for (let i = 0; i < width * height * 3; i++) checksum = (checksum + i) % 0xffffff
  return { src, width, height, checksum, size: width * height * 3 }
})

// Simulates document parsing (e.g., CSV → structured records)
const parseCSV = task((csv: string, delimiter: string) => {
  const lines = csv.trim().split('\n')
  const headers = lines[0].split(delimiter)
  return lines.slice(1).map((line) => {
    const values = line.split(delimiter)
    return Object.fromEntries(headers.map((h, i) => [h, values[i]]))
  })
})

// Simulates a hash/checksum computation
const computeHash = task((data: string, seed: number) => {
  // FNV-1a hash (no external dependencies)
  let hash = seed >>> 0
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
})

// ─── Single call ──────────────────────────────────────────────────────────────

{
  console.log('--- Single call ---')

  const result = await processImage('photo.jpg', 800, 600)
  console.log(`  Processed: ${result.src} → ${result.width}x${result.height}, size: ${result.size} bytes`)
}

// ─── Batch: same task, many inputs ───────────────────────────────────────────
//
// Call the task function in parallel with different arguments.
// All calls run in the thread pool concurrently.

{
  console.log('\n--- Batch: process 8 images in parallel ---')

  const images = [
    { src: 'thumb-1.jpg', w: 150, h: 150 },
    { src: 'thumb-2.jpg', w: 150, h: 150 },
    { src: 'banner.jpg', w: 1200, h: 400 },
    { src: 'hero.jpg', w: 1920, h: 1080 },
    { src: 'avatar.jpg', w: 64, h: 64 },
    { src: 'og-image.jpg', w: 1200, h: 630 },
    { src: 'favicon.png', w: 32, h: 32 },
    { src: 'cover.jpg', w: 800, h: 450 },
  ]

  const start = Date.now()
  const results = await Promise.all(
    images.map(({ src, w, h }) => processImage(src, w, h)),
  )
  const elapsed = Date.now() - start

  console.log(`  Processed ${results.length} images in ${elapsed}ms`)
  for (const r of results) {
    console.log(`  ${r.src}: ${r.width}x${r.height}`)
  }
}

// ─── Multiple task types in a WaitGroup ──────────────────────────────────────
//
// Mix different task() calls inside a WaitGroup for heterogeneous parallel work.

{
  console.log('\n--- Mixed tasks in WaitGroup ---')

  const csv = `id,name,score\n1,Alice,95\n2,Bob,87\n3,Carol,92`

  const wg = new WaitGroup()

  // These three heterogeneous tasks run in parallel
  let parsed: Record<string, string>[] = []
  let hash = ''
  let image: { width: number; height: number } | null = null

  wg.spawn(async () => {
    parsed = await parseCSV(csv, ',')
  }, { concurrent: true })

  wg.spawn(async () => {
    hash = await computeHash(csv, 0x811c9dc5)
  }, { concurrent: true })

  wg.spawn(async () => {
    image = await processImage('report.jpg', 400, 300)
  }, { concurrent: true })

  await wg.wait()

  console.log(`  Parsed ${parsed.length} CSV records`)
  console.log(`  CSV hash: ${hash}`)
  console.log(`  Image: ${image!.width}x${image!.height}`)
}
