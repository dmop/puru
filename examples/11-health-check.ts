/**
 * Example: Concurrent Service Health Checker
 *
 * Check the health of multiple services concurrently using fetch().
 * Uses task() to define a reusable check and select() + after()
 * for deadline-based racing.
 *
 * Primitives used: task(), spawn(), select(), after()
 */

import { task, spawn, select, after, configure } from '../dist/index.js'

configure({ adapter: 'auto' })

// ─── Reusable health check task ──────────────────────────────────────────────
//
// task() creates a typed function that runs in the thread pool.
// Arguments are serialized — pass the URL and timeout as plain values.

const checkHealth = task(async (url: string, timeoutMs: number) => {
  const start = performance.now()
  const res = await fetch(url, {
    method: 'HEAD',
    signal: AbortSignal.timeout(timeoutMs),
  })
  return {
    url,
    status: res.status,
    latency: Math.round(performance.now() - start),
    healthy: res.ok,
  }
})

// ─── Service definitions ─────────────────────────────────────────────────────

const services = [
  { name: 'GitHub API', url: 'https://api.github.com' },
  { name: 'npm Registry', url: 'https://registry.npmjs.org' },
  { name: 'httpbin', url: 'https://httpbin.org/get' },
  { name: 'jsonplaceholder', url: 'https://jsonplaceholder.typicode.com/posts/1' },
]

// ─── Check all services in parallel ──────────────────────────────────────────
//
// Each call to checkHealth() dispatches to the thread pool.
// allSettled gives us the full picture — one failure doesn't block the rest.

{
  console.log('--- Parallel health check ---\n')

  const start = performance.now()

  const settled = await Promise.allSettled(
    services.map((svc) => checkHealth(svc.url, 5000)),
  )

  const elapsed = Math.round(performance.now() - start)

  for (const [i, result] of settled.entries()) {
    const name = services[i].name.padEnd(20)
    if (result.status === 'fulfilled') {
      const r = result.value
      const icon = r.healthy ? 'OK' : 'FAIL'
      console.log(`  [${icon}]   ${name} HTTP ${r.status}  ${r.latency}ms`)
    } else {
      console.log(`  [FAIL] ${name} ${result.reason.message.slice(0, 50)}`)
    }
  }

  const healthy = settled.filter((r) => r.status === 'fulfilled').length
  console.log(`\n  ${healthy}/${services.length} healthy (${elapsed}ms total)`)
}

// ─── Fault tolerance: bad service mixed in ───────────────────────────────────
//
// One failing endpoint doesn't prevent us from getting results for the rest.
// This is the pattern for monitoring dashboards.

{
  console.log('\n--- Fault tolerance: bad service mixed in ---\n')

  const allServices = [
    ...services,
    { name: 'Bad Service', url: 'https://thisservicedoesnotexist.invalid' },
  ]

  const settled = await Promise.allSettled(
    allServices.map((svc) => checkHealth(svc.url, 3000)),
  )

  for (const [i, result] of settled.entries()) {
    const name = allServices[i].name.padEnd(20)
    if (result.status === 'fulfilled') {
      console.log(`  [OK]   ${name} ${result.value.latency}ms`)
    } else {
      console.log(`  [FAIL] ${name} ${result.reason.message.slice(0, 40)}`)
    }
  }
}

// ─── Race against a deadline with select() ───────────────────────────────────
//
// Sometimes you care about response time, not just success. select() picks
// whichever resolves first: the health check or a timeout.
// This is Go's `select { case <-done: ... case <-time.After(3s): ... }`.

{
  console.log('\n--- select(): check with deadline ---\n')

  // spawn() with concurrent mode for a single async check
  const { result } = spawn(
    async () => {
      const start = performance.now()
      const res = await fetch('https://api.github.com', {
        signal: AbortSignal.timeout(5000),
      })
      return {
        status: res.status,
        latency: Math.round(performance.now() - start),
      }
    },
    { concurrent: true },
  )

  let outcome = ''

  await select([
    [result, (r) => {
      const res = r as { status: number; latency: number }
      outcome = `GitHub API responded: HTTP ${res.status} in ${res.latency}ms`
    }],
    [after(3000), () => { outcome = 'Timed out — GitHub API took longer than 3s' }],
  ])

  console.log(`  ${outcome}`)
}
