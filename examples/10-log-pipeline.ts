/**
 * Example: Log Processing Pipeline
 *
 * A streaming ETL pipeline that processes structured log data:
 *
 *   generator → [ raw channel ] → parser workers → [ parsed channel ] → aggregator
 *
 * Demonstrates channels for backpressure, fan-out across workers,
 * and fan-in to a single consumer — all without shared memory.
 *
 * Primitives used: chan(), spawn(), channels
 */

import { chan, spawn, configure } from '../dist/index.js'

configure({ adapter: 'auto' })

// ─── Types ───────────────────────────────────────────────────────────────────

type RawLog = {
  timestamp: string
  level: string
  service: string
  message: string
  duration_ms?: number
}

type ParsedLog = {
  hour: number
  level: string
  service: string
  slow: boolean
}

// ─── Generate realistic log data ─────────────────────────────────────────────

// ─── Pipeline ────────────────────────────────────────────────────────────────

const NUM_LOGS = 500
const NUM_WORKERS = 4
const SLOW_THRESHOLD_MS = 1000

const raw = chan<RawLog>(50)       // backpressure: buffer 50 logs
const parsed = chan<ParsedLog>(50)

console.log(`Processing ${NUM_LOGS} log entries through ${NUM_WORKERS} workers...\n`)
const start = performance.now()

// Stage 1: Producer — push raw logs into the channel
spawn(
  async ({ raw }) => {
    const levels = ['info', 'warn', 'error', 'info', 'info', 'info', 'debug']
    const services = ['api-gateway', 'auth-service', 'user-service', 'payment-service', 'notification-service']
    const messages = [
      'Request completed', 'Cache miss', 'Rate limit exceeded', 'Timeout',
      'Health check passed', 'Token refreshed', 'Webhook delivered', 'Retry',
    ]
    for (let i = 0; i < 500; i++) {
      const hour = Math.floor(Math.random() * 24)
      const minute = Math.floor(Math.random() * 60)
      await raw.send({
        timestamp: `2025-01-15T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`,
        level: levels[i % levels.length],
        service: services[i % services.length],
        message: messages[i % messages.length],
        duration_ms: Math.random() > 0.7 ? Math.floor(Math.random() * 5000) : Math.floor(Math.random() * 200),
      })
    }
    raw.close()
  },
  { channels: { raw }, concurrent: true },
)

// Stage 2: Parser workers — fan-out from raw channel, fan-in to parsed channel
let workersRunning = NUM_WORKERS
for (let w = 0; w < NUM_WORKERS; w++) {
  spawn(
    async ({ raw, parsed }) => {
      for await (const log of raw) {
        const hour = parseInt(log.timestamp.split('T')[1].split(':')[0], 10)
        await parsed.send({
          hour,
          level: log.level,
          service: log.service,
          slow: (log.duration_ms ?? 0) > 1000,
        })
      }
    },
    { channels: { raw, parsed }, concurrent: true },
  ).result.finally(() => {
    workersRunning--
    if (workersRunning === 0) parsed.close()
  })
}

// Stage 3: Aggregator — consume parsed logs and build stats
const stats = {
  total: 0,
  byLevel: {} as Record<string, number>,
  byService: {} as Record<string, number>,
  slowRequests: 0,
  peakHour: -1,
  hourCounts: new Array(24).fill(0) as number[],
}

for await (const log of parsed) {
  stats.total++
  stats.byLevel[log.level] = (stats.byLevel[log.level] ?? 0) + 1
  stats.byService[log.service] = (stats.byService[log.service] ?? 0) + 1
  if (log.slow) stats.slowRequests++
  stats.hourCounts[log.hour]++
}

stats.peakHour = stats.hourCounts.indexOf(Math.max(...stats.hourCounts))
const elapsed = (performance.now() - start).toFixed(1)

// ─── Results ─────────────────────────────────────────────────────────────────

console.log(`Processed ${stats.total} logs in ${elapsed}ms\n`)

console.log('By level:')
for (const [level, count] of Object.entries(stats.byLevel).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${level.padEnd(8)} ${count}`)
}

console.log('\nBy service:')
for (const [service, count] of Object.entries(stats.byService).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${service.padEnd(24)} ${count}`)
}

console.log(`\nSlow requests (>${SLOW_THRESHOLD_MS}ms): ${stats.slowRequests}`)
console.log(`Peak hour: ${String(stats.peakHour).padStart(2, '0')}:00 (${stats.hourCounts[stats.peakHour]} requests)`)
