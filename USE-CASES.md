# puru (プール) — Production Use Cases

JavaScript runs on a single thread. When your server spends 200ms crunching data inside a request handler, every other request waits. This is the problem puru solves.

puru gives you a managed thread pool with Go-style concurrency primitives: inline functions, no worker files, channels, and structured concurrency. CPU-heavy work runs on dedicated worker threads, keeping the main event loop free. Below are the production scenarios where this matters.

---

## CPU-Bound Work in Request Handlers

The most common production pain point. A single slow computation blocks your entire server.

**The problem:** An Express/Fastify/Hono endpoint generates a report. It takes 300ms of pure CPU. During that time, health checks timeout, WebSocket pings are missed, and other requests queue up.

```ts
const generateReportTask = task((rows: Array<Record<string, unknown>>) => {
  // Put the expensive aggregation logic here so the worker has everything it needs.
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
  // Example placeholder for resize/encode logic.
  return { buffer, width, height }
})

// Process a batch of uploaded images in parallel
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

Backend-for-frontend (BFF) services that fan out to multiple microservices. Concurrent mode keeps threads efficient for I/O-heavy work.

```ts
import { ErrGroup } from '@dmop/puru'

const makeFetchTask = (url: string) =>
  new Function(`return fetch(${JSON.stringify(url)}).then((r) => r.json())`) as () => Promise<unknown>

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

All fetches and JSON parsing happen off the main thread. Under load, the main event loop stays free while those worker tasks wait on I/O.

**Production scenarios:**

- BFF aggregation layers (mobile apps, dashboards)
- Health check endpoints that probe multiple services
- Price comparison (query multiple providers)
- Search federation (query multiple indexes, merge results)

---

## Cryptographic Operations at Scale

Password hashing, token verification, and encryption are intentionally slow (that's the point of bcrypt/argon2). At scale, they will destroy your event loop.

```ts
const comparePasswordTask = task((password: string, hash: string) => {
  return password === hash
})

// Auth service handling 100+ login attempts/sec
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
- Encryption/decryption of PII fields before storage

---

## Request-Level Timeouts with Context

Go's `context` package is the standard way to propagate deadlines and cancellation. puru's context works the same: derive child contexts from a parent, and cancellation flows downward.

```ts
import { background, withTimeout, withValue, WaitGroup } from '@dmop/puru'

app.get('/dashboard/:tenantId', async (req, res) => {
  // 1. Create a context with a 2s SLA and request metadata
  const ctx = withValue(background(), 'tenantId', req.params.tenantId)
  const [reqCtx, cancel] = withTimeout(ctx, 2000)

  const wg = new WaitGroup()
  wg.spawn(() => aggregateSales(/* inline */), { concurrent: true })
  wg.spawn(() => aggregateUsers(/* inline */), { concurrent: true })
  wg.spawn(() => aggregateRevenue(/* inline */), { concurrent: true })

  // Cancel all tasks if the deadline passes
  reqCtx.done().then(() => wg.cancel())

  try {
    const [sales, users, revenue] = await wg.wait()
    res.json({ sales, users, revenue })
  } catch {
    if (reqCtx.err?.name === 'DeadlineExceededError') {
      res.status(504).json({ error: 'Request timed out' })
    } else {
      res.status(500).json({ error: 'Internal error' })
    }
  } finally {
    cancel() // always clean up — clears the timer
  }
})
```

**Why context over raw `setTimeout`:**

- **Composable** — nest `withTimeout` inside `withTimeout`, the shorter deadline always wins
- **Hierarchical** — cancel a parent and all children cancel automatically
- **Value propagation** — carry trace IDs, user IDs, or tenant IDs without threading args
- **Clean API** — `ctx.done()`, `ctx.err`, `ctx.signal` integrate with existing patterns

**Production scenarios:**

- Request-level SLA enforcement (API gateways, BFFs)
- Graceful shutdown (cancel all in-flight work with a single root cancel)
- Nested timeouts (outer request timeout + inner per-service timeout)
- Distributed tracing (attach trace/span IDs to the context chain)

---

## Batch Processing with Deadlines

Real-time systems need bounded response times. `select` + `after` lets you race computation against a deadline — return the best result you have before timeout.

```ts
const searchPrimaryIndexTask = task((query: string) => {
  return { results: [query], partial: false }
})

const searchSecondaryIndexTask = task((query: string) => {
  return { results: [`deep:${query}`], partial: false }
})

// Search with a 200ms SLA
app.get('/search', async (req, res) => {
  const query = req.query.q

  const fast = searchPrimaryIndexTask(String(query))
  const deep = searchSecondaryIndexTask(String(query))

  let response: SearchResult

  await select([
    [fast, (r) => { response = r }],
    [after(200), () => { response = { results: [], partial: true } }],
  ])

  // If the deep search finished in time, merge it
  const settled = await Promise.race([deep, after(50).then(() => null)])
  if (settled) response = mergeResults(response, settled)

  res.json(response)
})
```

**Production scenarios:**

- Search with SLA guarantees (return partial results on timeout)
- Recommendation engines with fallback to cached results
- Auction/bidding systems with hard deadlines
- Geo-routing with timeout fallback to default provider

---

## Scheduled Background Jobs

Offload periodic work so it never impacts request handling.

```ts
const rankAndBucketTask = task((scores: number[]) => {
  return scores.sort((a, b) => b - a)
})

const compactAndAggregateTask = task((table: string) => {
  return table
})

// Every 5 minutes: recompute leaderboard
setInterval(async () => {
  const scores = computeAllPlayerScores()  // CPU-heavy preparation can also be moved into task() if needed
  const leaderboard = await rankAndBucketTask(scores)
  await cache.set('leaderboard', leaderboard, { ttl: 300 })
}, 5 * 60_000)

// Every hour: clean and aggregate metrics
setInterval(async () => {
  await Promise.all(METRIC_TABLES.map((table) => compactAndAggregateTask(table)))
}, 60 * 60_000)
```

**Production scenarios:**

- Leaderboard/ranking recomputation (gaming, e-commerce)
- Cache warming with pre-computed data
- Metrics aggregation and compaction
- Sitemap regeneration
- Stale session cleanup with heavy validation logic

---

## Protecting Shared Resources with Mutex

When concurrent tasks access a shared resource (rate limiter, connection pool, cache), Mutex serializes access to prevent corruption.

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
  // ... handle request
})
```

**Production scenarios:**

- Rate limiting with shared counters
- Connection pool checkout/return
- Write-through cache coordination
- Sequence number generation

---

## Fail-Fast with ErrGroup

When fetching from multiple services, fail fast and cancel remaining work on first error — don't waste resources on a request that's already failed.

```ts
const makeProfileTask = (userId: string) =>
  new Function(`return ({ userId: ${JSON.stringify(userId)} })`) as () => { userId: string }

const makeOrdersTask = (userId: string) =>
  new Function(`return ([{ userId: ${JSON.stringify(userId)} }])`) as () => Array<{ userId: string }>

const makeNotificationsTask = (userId: string) =>
  new Function(`return ([{ userId: ${JSON.stringify(userId)}, unread: true }])`) as () => Array<{ userId: string; unread: true }>

app.get('/dashboard', async (req, res) => {
  const eg = new ErrGroup()
  const userId = String(req.user)

  eg.spawn(makeProfileTask(userId))
  eg.spawn(makeOrdersTask(userId))
  eg.spawn(makeNotificationsTask(userId))

  try {
    const [profile, orders, notifications] = await eg.wait()
    res.json({ profile, orders, notifications })
  } catch (err) {
    // First service that failed cancelled the rest
    res.status(502).json({ error: 'Upstream service failed' })
  }
})
```

**ErrGroup vs WaitGroup:** ErrGroup cancels remaining tasks on first failure (3.7x faster in benchmarks). WaitGroup waits for everything regardless. Use ErrGroup when partial results are useless.

---

## Lazy Initialization with Once

Expensive resources (DB connections, ML models, caches) should be initialized once, even under concurrent load during startup.

```ts
const initDB = new Once<DBPool>()
const initModel = new Once<Model>()
const predictTask = task((features: unknown) => features)

app.get('/predict', async (req, res) => {
  // Both initialize exactly once, even with 100 concurrent requests at startup
  const [db, model] = await Promise.all([
    initDB.do(() => createPool({ max: 10 })),
    initModel.do(() => loadModel('./weights.bin')),  // 500ms cold start
  ])

  const data = await db.query('SELECT features FROM inputs WHERE id = ?', [req.params.id])
  // The worker cannot capture `model`; pass serializable inputs into a task or load the model inside the worker.
  res.json(await predictTask(data))
})
```

---

## Non-Blocking Channel Polling with select default

Go's `select` with `default` lets you try to read/write a channel without blocking. Use it for polling loops, try-send patterns, and non-blocking checks.

```ts
// Try to read from a channel — don't block if empty
await select(
  [[ch.recv(), (msg) => process(msg)]],
  { default: () => { /* channel empty, do something else */ } },
)

// Worker loop: process channel messages, do background work when idle
const t = ticker(100)
for await (const _ of t) {
  await select(
    [[jobChannel.recv(), (job) => processJob(job)]],
    { default: () => doIdleWork() },
  )
}
```

---

## Periodic Work with Ticker

Replace `setInterval` with `Ticker` for structured periodic work that integrates with `select` and async iteration.

```ts
const computeLeaderboardTask = task(() => {
  return { leaders: [] }
})

const checkAllServicesTask = task(() => {
  return { status: 'ok' as const }
})

// Recompute leaderboard every 5 minutes
const leaderboardTicker = ticker(5 * 60_000)
for await (const _ of leaderboardTicker) {
  await cache.set('leaderboard', await computeLeaderboardTask())
}

// Health check loop with timeout
const healthTicker = ticker(10_000)
for await (const _ of healthTicker) {
  await select([
    [spawn(() => ({ status: 'ok' as const }), { concurrent: true }).result,
      (status) => reportHealth(status)],
    [after(5000), () => reportHealth({ status: 'timeout' })],
  ])
}
```

---

## When NOT to Use puru

### Simple async I/O

If you're awaiting 3 fetch calls and your server isn't under CPU pressure, `Promise.all` is simpler and has zero overhead:

```ts
// This is fine. Don't overcomplicate it.
const [users, orders, config] = await Promise.all([
  fetch('/api/users').then(r => r.json()),
  fetch('/api/orders').then(r => r.json()),
  fetch('/api/config').then(r => r.json()),
])
```

Use puru's concurrent mode when you have **many I/O-heavy tasks** or need to **keep the main thread responsive under load**.

### Tasks faster than 5ms

Spawn overhead is ~0.1-0.5ms (function serialization + thread dispatch). For micro-tasks, call them directly:

```ts
// Bad — overhead > task cost
spawn(() => 1 + 1)
spawn(() => [1, 2, 3].map((x) => x * 2))  // 0.01ms of work

// Good — enough work to justify the thread
spawn(() => {
  const millionRows = Array.from({ length: 1_000_000 }, (_, i) => i)
  return millionRows.reduce((sum, value) => sum + value, 0)
})  // 50ms of work
```

### Shared mutable state

Workers don't share memory. If tasks need to read/write the same data structure, use channels to coordinate:

```ts
// Won't work: counter is not shared across threads
let counter = 0
spawn(() => { counter++ })  // counter is undefined in the worker

// Works: use a channel to collect results
const ch = chan<number>(10)
spawn(async ({ ch }) => { await ch.send(1) }, { channels: { ch } })
```

### Tasks that need closures

Functions are serialized via `.toString()`. They cannot capture variables from the enclosing scope:

```ts
const threshold = 100
spawn(() => filterAbove(data, threshold))  // threshold is undefined

// Instead, pass values explicitly with task()
const filterAboveTask = task((data: number[], threshold: number) => data.filter((n) => n > threshold))
const result = await filterAboveTask(data, 100)
```

---

## Exclusive vs Concurrent Mode

| | Exclusive (`spawn(fn)`) | Concurrent (`spawn(fn, { concurrent: true })`) |
| --- | --- | --- |
| **Best for** | CPU-bound work | I/O-bound / async work |
| **Tasks per thread** | 1 | Up to 64 (configurable) |
| **Thread usage** | Saturates a core | Shares the event loop |
| **Typical task** | > 5ms of CPU | `await fetch()`, `await db.query()` |
| **Examples** | Hashing, sorting, compression | HTTP fan-out, DB reads, file I/O |
| **When in doubt** | Use this | Use when tasks mostly `await` |

Both modes run simultaneously on the same thread pool. The scheduler handles the mix.

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

## Benchmark Results

Measured on **Apple M1 Pro**.

### CPU-Bound Parallelism (Node.js v24)

| Benchmark | Without puru | With puru | Speedup |
| --- | --- | --- | --- |
| Fibonacci (fib(38) x8) | 4,345ms | 2,131ms | **2.0x** |
| Prime counting (2M range) | 335ms | 77ms | **4.4x** |
| Matrix multiply (200x200 x8) | 140ms | 39ms | **3.6x** |
| Data processing (100K x8) | 221ms | 67ms | **3.3x** |

### Channel Fan-Out Pipeline (Node.js v24)

| Approach | Time | Speedup |
| --- | --- | --- |
| Sequential (no channels) | 176ms | baseline |
| Main-thread channels only | 174ms | 1.0x |
| **puru fan-out (4 workers)** | **51ms** | **3.4x faster** |

### M:N Concurrent Async (Node.js v24)

100 async tasks with simulated I/O, running off the main thread:

| Approach | Time | Speedup |
| --- | --- | --- |
| Sequential | 1,140ms | baseline |
| **puru concurrent (M:N)** | **16ms** | **73x** |

### Run benchmarks yourself

```bash
npm run bench              # all benchmarks (Node.js)
npm run bench:bun          # all benchmarks (Bun)
npm run bench:fib          # Fibonacci
npm run bench:primes       # Prime counting
npm run bench:matrix       # Matrix multiply
npm run bench:data         # Data processing
npm run bench:overhead     # Spawn overhead
npm run bench:channels     # Channel fan-out pipeline
npm run bench:concurrent   # M:N concurrent async
npm run bench:mutex        # Mutex contention
npm run bench:errgroup     # ErrGroup vs WaitGroup
npm run bench:select       # select() with default case
npm run bench:once         # Once + Ticker
```

## Supported Runtimes

| Runtime | Status |
| --- | --- |
| Node.js >= 20 | Full support (`worker_threads`) |
| Bun | Full support (Web Workers) |
| Deno | Planned |
| Cloudflare Workers | Not supported (no threads) |
| Vercel Edge | Not supported (no threads) |
