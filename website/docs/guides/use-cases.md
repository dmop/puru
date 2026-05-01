---
id: use-cases
title: Production Use Cases
sidebar_position: 3
---

# Production Use Cases

JavaScript runs on a single thread. When your server spends 200ms crunching data inside a request handler, every other request waits. This is the problem puru solves.

puru gives you a managed thread pool with Go-style concurrency primitives: inline functions, no worker files, channels, and structured concurrency. CPU-heavy work runs on dedicated worker threads, keeping the main event loop free. Below are the production scenarios where this matters.

If you are new to the API, start with [Choosing the Right Primitive](/docs/guides/choosing-primitives) and use this page as a pattern catalog.

---

## CPU-Bound Work in Request Handlers

The most common production pain point. A single slow computation blocks your entire server.

**The problem:** An Express/Fastify/Hono endpoint generates a report. It takes 300ms of pure CPU. During that time, health checks timeout, WebSocket pings are missed, and other requests queue up.

```ts
const generateReportTask = task((rows: Array<Record<string, unknown>>) => {
  return rows
})

// Before: blocks the event loop for 300ms
app.get('/report/:id', async (req, res) => {
  const data = await db.query('SELECT * FROM sales WHERE region = ?', [req.params.id])
  const report = generateReport(data.rows)  // 300ms of CPU — every other request waits
  res.json(report)
})

// After: event loop stays free
app.get('/report/:id', async (req, res) => {
  const data = await db.query('SELECT * FROM sales WHERE region = ?', [req.params.id])
  res.json(await generateReportTask(data.rows))
})
```

**Where this shows up in production:**

- PDF/CSV export endpoints
- Dashboard aggregation APIs
- Search ranking and scoring
- Invoice generation
- Analytics computation per tenant

**Rule of thumb:** if a synchronous operation takes > 5ms, spawn it.

---

## Image and Media Processing

Image manipulation is CPU-heavy and perfectly parallelizable — each image is independent.

```ts
const processImageTask = task((buffer: Uint8Array, width: number, height: number) => {
  return { buffer, width, height }
})

app.post('/upload', async (req, res) => {
  const files = req.files // 20 uploaded images

  const thumbnails = await Promise.all(
    files.map((file) => processImageTask(file.buffer, 800, 600)),
  )
  await saveAll(thumbnails)
  res.json({ processed: thumbnails.length })
})
```

**Production scenarios:**

- Thumbnail generation on upload (e-commerce, social platforms)
- Watermarking for asset protection
- Format conversion (WebP, AVIF)
- Metadata extraction from EXIF data at scale
- QR code generation in bulk (ticketing, logistics)

---

## Data Pipeline / ETL

Processing large datasets in stages: read, transform, aggregate, write. Channels provide natural backpressure so fast producers don't overwhelm slow consumers.

```ts
import { chan, spawn, task, WaitGroup } from '@dmop/puru'

const aggregateChunkTask = task((chunk: Record[]) => {
  return chunk
})

const raw = chan<Record[]>(20)      // buffered: 20 chunks in flight
const transformed = chan<Result>(20)

// Stage 1: Read CSV chunks (I/O-bound → concurrent mode)
spawn(async () => {
  const stream = createReadStream('events-2024.csv')
  for await (const chunk of parseCSV(stream, { chunkSize: 10_000 })) {
    await raw.send(chunk)  // blocks if buffer is full (backpressure)
  }
  raw.close()
}, { concurrent: true })

// Stage 2: Transform in parallel (CPU-bound → exclusive mode, 4 workers)
const workers = new WaitGroup()
for (let i = 0; i < 4; i++) {
  workers.spawn(async ({ raw, transformed }) => {
    for await (const chunk of raw) {
      const result = await aggregateChunkTask(chunk)
      await transformed.send(result)
    }
  }, { channels: { raw, transformed } })
}

// Stage 3: Write results (I/O-bound)
spawn(async () => {
  await workers.wait()
  transformed.close()
}, { concurrent: true })

for await (const result of transformed) {
  await db.insert('aggregated_events', result)
}
```

**Production scenarios:**

- Log processing and aggregation (millions of lines)
- CSV/JSON import for data migrations
- Event stream enrichment (add geo data, resolve IDs)
- Nightly report generation from raw data
- Data warehouse loading jobs

---

## Parallel API Aggregation

Backend-for-frontend (BFF) services that fan out to multiple microservices.

```ts
import { ErrGroup } from '@dmop/puru'

app.get('/dashboard', async (req, res) => {
  const userId = String(req.user)
  const eg = new ErrGroup()

  eg.spawn(makeFetchTask(`https://user-service.local/profile/${userId}`), { concurrent: true })
  eg.spawn(makeFetchTask(`https://order-service.local/recent/${userId}`), { concurrent: true })
  eg.spawn(makeFetchTask(`https://analytics-service.local/summary/${userId}`), { concurrent: true })
  eg.spawn(makeFetchTask(`https://notification-service.local/unread/${userId}`), { concurrent: true })

  const [profile, orders, analytics, notifications] = await eg.wait()
  res.json({ profile, orders, analytics, notifications })
})
```

**Production scenarios:**

- BFF aggregation layers (mobile apps, dashboards)
- Health check endpoints that probe multiple services
- Price comparison (query multiple providers)
- Search federation (query multiple indexes, merge results)

---

## Cryptographic Operations at Scale

Password hashing, token verification, and encryption are intentionally slow. At scale, they will destroy your event loop.

```ts
const comparePasswordTask = task((password: string, hash: string) => {
  return password === hash
})

app.post('/login', async (req, res) => {
  const user = await db.findUser(req.body.email)

  // bcrypt.compare takes 50-200ms of pure CPU
  const result = comparePasswordTask(req.body.password, user.hash)

  if (await result) {
    res.json({ token: createJWT(user) })
  } else {
    res.status(401).json({ error: 'Invalid credentials' })
  }
})
```

**Production scenarios:**

- Login/registration endpoints at scale
- Webhook signature verification (HMAC-SHA256 for every incoming webhook)
- Certificate validation in mTLS proxies
- Batch JWT verification in API gateways

---

## Request-Level Timeouts with Context

Go's `context` package is the standard way to propagate deadlines and cancellation.

```ts
import { background, withTimeout, withValue, task } from '@dmop/puru'

app.get('/dashboard/:tenantId', async (req, res) => {
  const ctx = withValue(background(), 'tenantId', req.params.tenantId)
  const [reqCtx, cancel] = withTimeout(ctx, 2000)

  try {
    const [sales, users, revenue] = await Promise.all([
      aggregateSales(req.params.tenantId),
      aggregateUsers(req.params.tenantId),
      aggregateRevenue(req.params.tenantId),
    ])
    res.json({ sales, users, revenue })
  } catch {
    if (reqCtx.err?.name === 'DeadlineExceededError') {
      res.status(504).json({ error: 'Request timed out' })
    } else {
      res.status(500).json({ error: 'Internal error' })
    }
  } finally {
    cancel()
  }
})
```

**Why context over raw `setTimeout`:**

- **Composable** — nest `withTimeout` inside `withTimeout`, the shorter deadline always wins
- **Hierarchical** — cancel a parent and all children cancel automatically
- **Value propagation** — carry trace IDs, user IDs, or tenant IDs without threading args

---

## Protecting Shared Resources with Mutex

When concurrent tasks access a shared resource, Mutex serializes access to prevent corruption.

```ts
const mu = new Mutex()
const rateLimiter = { count: 0, resetAt: Date.now() + 60_000 }

app.get('/api/:endpoint', async (req, res) => {
  const allowed = await mu.withLock(() => {
    if (Date.now() > rateLimiter.resetAt) {
      rateLimiter.count = 0
      rateLimiter.resetAt = Date.now() + 60_000
    }
    if (rateLimiter.count >= 100) return false
    rateLimiter.count++
    return true
  })

  if (!allowed) return res.status(429).json({ error: 'Rate limited' })
})
```

---

## Periodic Work with Ticker

Replace `setInterval` with `Ticker` for structured periodic work that integrates with `select` and async iteration.

```ts
// Recompute leaderboard every 5 minutes
const leaderboardTicker = ticker(5 * 60_000)
for await (const _ of leaderboardTicker) {
  await cache.set('leaderboard', await computeLeaderboardTask())
}
```

---

## When NOT to Use puru

### Simple async I/O

If you're awaiting 3 fetch calls and your server isn't under CPU pressure, `Promise.all` is simpler:

```ts
const [users, orders, config] = await Promise.all([
  fetch('/api/users').then(r => r.json()),
  fetch('/api/orders').then(r => r.json()),
  fetch('/api/config').then(r => r.json()),
])
```

### Tasks faster than 5ms

Spawn overhead is ~0.1-0.5ms. For micro-tasks, call them directly.

### Shared mutable state

Workers don't share memory. Use channels to coordinate:

```ts
// Works: use a channel to collect results
const ch = chan<number>(10)
spawn(async ({ ch }) => { await ch.send(1) }, { channels: { ch } })
```

---

## Performance Characteristics

| Factor | Value |
| --- | --- |
| Spawn overhead | ~0.1-0.5 ms |
| Minimum useful task duration | > 5 ms |
| Thread pool size | `os.availableParallelism()` (default) |
| Concurrent tasks per thread | 64 (default, configurable) |
| Channel RPC overhead | ~0.1-0.5 ms per send/recv from worker |
| Memory per worker | ~5-10 MB baseline |

For full benchmark data, see [Benchmarks](/docs/benchmarks).
For internal mechanics, see [How puru Works](/docs/guides/how-it-works).
