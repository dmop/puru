# puru (プール)

A thread pool with Go-style concurrency primitives for JavaScript — spawn tasks off the main thread with channels, WaitGroup, select, and more. No worker files, no boilerplate.

Works on **Node.js** and **Bun**. Deno support coming soon.

*puru (プール) means "pool" in Japanese.*

## Install

```bash
npm install @dmop/puru
# or
bun add @dmop/puru
```

## Quick Start

```typescript
import { spawn, chan, WaitGroup, select, after } from '@dmop/puru'

// CPU work — runs in a dedicated worker thread
const { result } = spawn(() => fibonacci(40))
console.log(await result)

// I/O work — many tasks share worker threads
const wg = new WaitGroup()
for (const url of urls) {
  wg.spawn(() => fetch(url).then(r => r.json()), { concurrent: true })
}
const results = await wg.wait()
```

## How It Works

puru manages a **thread pool** — tasks are dispatched onto a fixed set of worker threads:

```text
              puru thread pool
    ┌──────────────────────────────┐
    │                              │
    │   Task 1 ─┐                  │
    │   Task 2 ─┤──► Thread 1     │
    │   Task 3 ─┘    (shared)     │
    │                              │
    │   Task 4 ────► Thread 2     │  N threads
    │                (exclusive)   │  (os.availableParallelism)
    │                              │
    │   Task 5 ─┐                  │
    │   Task 6 ─┤──► Thread 3     │
    │   Task 7 ─┘    (shared)     │
    │                              │
    └──────────────────────────────┘
```

**Two modes:**

| Mode | Flag | Best for | How it works |
| --- | --- | --- | --- |
| **Exclusive** (default) | `spawn(fn)` | CPU-bound work | 1 task per thread, full core usage |
| **Concurrent** | `spawn(fn, { concurrent: true })` | I/O-bound / async work | Many tasks share a thread's event loop |

CPU-bound work gets a dedicated thread. I/O-bound work shares threads efficiently. The API is inspired by Go's concurrency primitives (channels, WaitGroup, select), but the underlying mechanism is a thread pool — not a green thread scheduler.

## Why puru

Same task, four ways — process 4 items in parallel:

**worker_threads** — 2 files, 15 lines, manual everything:

```typescript
// worker.js (separate file required)
const { parentPort } = require('worker_threads')
parentPort.on('message', (data) => {
  parentPort.postMessage(heavyWork(data))
})

// main.js
import { Worker } from 'worker_threads'
const results = await Promise.all(items.map(item =>
  new Promise((resolve, reject) => {
    const w = new Worker('./worker.js')
    w.postMessage(item)
    w.on('message', resolve)
    w.on('error', reject)
  })
))
```

**Tinypool** — still needs a separate file:

```typescript
// worker.js (separate file required)
export default function(data) { return heavyWork(data) }

// main.js
import Tinypool from 'tinypool'
const pool = new Tinypool({ filename: './worker.js' })
const results = await Promise.all(items.map(item => pool.run(item)))
```

**Piscina** — same pattern, separate file:

```typescript
// worker.js (separate file required)
module.exports = function(data) { return heavyWork(data) }

// main.js
import Piscina from 'piscina'
const pool = new Piscina({ filename: './worker.js' })
const results = await Promise.all(items.map(item => pool.run(item)))
```

**puru** — one file, 4 lines:

```typescript
import { WaitGroup } from '@dmop/puru'
const wg = new WaitGroup()
for (const item of items) wg.spawn(() => heavyWork(item))
const results = await wg.wait()
```

| Feature | worker_threads | Tinypool | Piscina | **puru** |
| --- | --- | --- | --- | --- |
| Separate worker file | Required | Required | Required | **Not needed** |
| Inline functions | No | No | No | **Yes** |
| Managed thread pool | No | No | No | **Yes** |
| Concurrent mode (I/O) | No | No | No | **Yes** |
| Channels (cross-thread) | No | No | No | **Yes** |
| Cancellation | No | No | No | **Yes** |
| WaitGroup / ErrGroup | No | No | No | **Yes** |
| select (with default) | No | No | No | **Yes** |
| Mutex / Once | No | No | No | **Yes** |
| Ticker | No | No | No | **Yes** |
| Backpressure | No | No | No | **Yes** |
| Priority scheduling | No | No | Yes | **Yes** |
| Pool management | Manual | Automatic | Automatic | **Automatic** |
| Bun support | No | No | No | **Yes** |

### puru vs Node.js Cluster

These solve different problems and are meant to be used together in production.

**Node Cluster** copies your entire app into N processes. The OS load-balances incoming connections across them. The goal is request throughput — use all cores to handle more concurrent HTTP requests.

**puru** manages a thread pool inside a single process. Heavy tasks are offloaded off the main event loop to worker threads. The goal is CPU task isolation — use all cores without blocking the event loop.

```text
Node Cluster (4 processes):

         OS / Load Balancer
    ┌─────────┬─────────┬─────────┐
    ▼         ▼         ▼         ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│Process │ │Process │ │Process │ │Process │
│full app│ │full app│ │full app│ │full app│
│own DB  │ │own DB  │ │own DB  │ │own DB  │
│~100MB  │ │~100MB  │ │~100MB  │ │~100MB  │
└────────┘ └────────┘ └────────┘ └────────┘

puru (1 process, thread pool):

┌──────────────────────────────────────┐
│          Your App (1 process)        │
│                                      │
│  Main thread — handles HTTP, DB, I/O │
│                                      │
│  ┌──────────┐  ┌──────────┐         │
│  │ Thread 1 │  │ Thread 2 │  ...    │
│  │ CPU task │  │ CPU task │         │
│  └──────────┘  └──────────┘         │
│  shared memory, one DB pool          │
└──────────────────────────────────────┘
```

What happens without puru, even with Cluster:

```text
Request 1 → Process 1 → resize image (2s) → Process 1 event loop FROZEN
Request 2 → Process 2 → handles fine ✓
Request 3 → Process 3 → handles fine ✓
(other processes still work, but each process still blocks on heavy tasks)

With puru inside each process:
Request 1 → spawn(resizeImage) → worker thread, main thread free ✓
Request 2 → main thread handles instantly ✓
Request 3 → main thread handles instantly ✓
```

In production, use both:

```text
PM2 / Cluster (4 processes)    ← maximise request throughput
  └── each process runs puru   ← keep each event loop unblocked
```

| | Cluster | puru |
| --- | --- | --- |
| Unit | Process | Thread |
| Memory | ~100MB per copy | Shared, much lower |
| Shared state | Needs Redis/IPC | Same process |
| Solves | Request throughput | CPU task offloading |
| Event loop | Still blocks per process | Never blocks |
| DB connections | One pool per process | One pool total |
| Bun support | No cluster module | Yes |

## API

### `spawn(fn, opts?)`

Run a function in a worker thread. Returns `{ result: Promise<T>, cancel: () => void }`.

```typescript
// CPU-bound — exclusive mode (default)
const { result } = spawn(() => fibonacci(40))

// I/O-bound — concurrent mode (many tasks per thread)
const { result } = spawn(() => fetch(url), { concurrent: true })

// With priority
const { result } = spawn(() => criticalWork(), { priority: 'high' })

// Cancel
const { result, cancel } = spawn(() => longTask())
setTimeout(cancel, 5000)
```

**Exclusive mode** (default): the function gets a dedicated thread. Use for CPU-heavy work.

**Concurrent mode** (`{ concurrent: true }`): multiple tasks share a thread's event loop. Use for async/I/O work where you want to run thousands of tasks without thousands of threads.

Functions must be self-contained — they cannot capture variables from the enclosing scope:

```typescript
const x = 42
spawn(() => x + 1)   // ReferenceError: x is not defined
spawn(() => 42 + 1)  // works
```

### `chan(capacity?)`

Create a channel for communicating between async tasks — including across worker threads.

```typescript
const ch = chan<number>(10) // buffered, capacity 10
const ch = chan<string>()   // unbuffered, capacity 0

await ch.send(42)
const value = await ch.recv() // 42

ch.close()
await ch.recv() // null (closed)

// Async iteration
for await (const value of ch) {
  process(value)
}
```

**Channels in workers** — pass channels to `spawn()` and use them across worker threads:

```typescript
const ch = chan<number>(10)

// Producer worker
spawn(async ({ ch }) => {
  for (let i = 0; i < 100; i++) await ch.send(i)
  ch.close()
}, { channels: { ch } })

// Consumer worker
spawn(async ({ ch }) => {
  for await (const item of ch) process(item)
}, { channels: { ch } })

// Fan-out: multiple workers pulling from the same channel
const input = chan<Job>(50)
const output = chan<Result>(50)

for (let i = 0; i < 4; i++) {
  spawn(async ({ input, output }) => {
    for await (const job of input) {
      await output.send(processJob(job))
    }
  }, { channels: { input, output } })
}
```

### `WaitGroup`

Structured concurrency. Spawn multiple tasks, wait for all.

```typescript
const wg = new WaitGroup()
wg.spawn(() => cpuWork())                          // exclusive
wg.spawn(() => fetchData(), { concurrent: true })  // concurrent

const results = await wg.wait()        // resolves when all tasks succeed
const settled = await wg.waitSettled() // resolves when all tasks settle

wg.cancel() // cancel all tasks
```

### `ErrGroup`

Like `WaitGroup`, but cancels all remaining tasks on first error. The Go standard for production code (`golang.org/x/sync/errgroup`).

```typescript
const eg = new ErrGroup()
eg.spawn(() => fetchUser(id))
eg.spawn(() => fetchOrders(id))
eg.spawn(() => fetchAnalytics(id))

try {
  const [user, orders, analytics] = await eg.wait()
} catch (err) {
  // First error — all other tasks were cancelled
  console.error('Failed:', err)
}
```

### `Mutex`

Async mutual exclusion. Serialize access to shared resources under concurrency.

```typescript
const mu = new Mutex()

// withLock — recommended (auto-unlocks on error)
const result = await mu.withLock(async () => {
  return await db.query('UPDATE ...')
})

// Manual lock/unlock
await mu.lock()
try { /* critical section */ }
finally { mu.unlock() }
```

### `Once<T>`

Run a function exactly once, even if called concurrently. All callers get the same result.

```typescript
const once = new Once<DBConnection>()
const conn = await once.do(() => createExpensiveConnection())
// Subsequent calls return the cached result
```

### `select(cases, opts?)`

Wait for the first of multiple promises to resolve, like Go's `select`.

```typescript
// Blocking — waits for first ready
await select([
  [ch.recv(), (value) => console.log('received', value)],
  [after(5000), () => console.log('timeout')],
])

// Non-blocking — returns immediately if nothing is ready (Go's select with default)
await select(
  [[ch.recv(), (value) => process(value)]],
  { default: () => console.log('channel not ready') },
)
```

### `after(ms)` / `ticker(ms)`

Timers for use with `select` and async iteration.

```typescript
await after(1000) // one-shot: resolves after 1 second

// Repeating: tick every 500ms
const t = ticker(500)
for await (const _ of t) {
  console.log('tick')
  if (shouldStop) t.stop()
}
```

### `register(name, fn)` / `run(name, ...args)`

Named task registry. Register functions by name, call them by name.

```typescript
register('resize', (buffer, w, h) => sharp(buffer).resize(w, h).toBuffer())
const resized = await run('resize', imageBuffer, 800, 600)
```

### `configure(opts?)`

Optional global configuration. Must be called before the first `spawn()`.

```typescript
configure({
  maxThreads: 4,        // default: os.availableParallelism()
  concurrency: 64,      // max concurrent tasks per shared worker (default: 64)
  idleTimeout: 30_000,  // kill idle workers after 30s (default)
  adapter: 'auto',      // 'auto' | 'node' | 'bun' | 'inline'
})
```

### `stats()` / `resize(n)`

```typescript
const s = stats()  // { totalWorkers, idleWorkers, busyWorkers, queuedTasks, ... }
resize(8)          // scale pool up/down at runtime
```

### `detectRuntime()` / `detectCapability()`

```typescript
detectRuntime()     // 'node' | 'bun' | 'deno' | 'browser'
detectCapability()  // 'full-threads' | 'single-thread'
```

## Benchmarks

Apple M1 Pro (8 cores), 16 GB RAM. Median of 5 runs after warmup.

```bash
npm run bench          # all benchmarks (Node.js)
npm run bench:bun      # all benchmarks (Bun)
```

### CPU-Bound Parallelism

| Benchmark | Without puru | With puru | Speedup |
| --- | --: | --: | --: |
| Fibonacci (fib(38) x8) | 4,345 ms | 2,131 ms | **2.0x** |
| Prime counting (2M range) | 335 ms | 77 ms | **4.4x** |
| Matrix multiply (200x200 x8) | 140 ms | 39 ms | **3.6x** |
| Data processing (100K items x8) | 221 ms | 67 ms | **3.3x** |

<details>
<summary>Bun results</summary>

| Benchmark | Without puru | With puru | Speedup |
| --- | --: | --: | --: |
| Fibonacci (fib(38) x8) | 2,208 ms | 380 ms | **5.8x** |
| Prime counting (2M range) | 201 ms | 50 ms | **4.0x** |
| Matrix multiply (200x200 x8) | 197 ms | 57 ms | **3.5x** |
| Data processing (100K items x8) | 214 ms | 109 ms | **2.0x** |

</details>

### Channels Fan-Out Pipeline

200 items with CPU-heavy transform, 4 parallel transform workers:

| Approach | Time | vs Sequential |
| --- | --: | --: |
| Sequential (no channels) | 176 ms | baseline |
| Main-thread channels only | 174 ms | 1.0x |
| **puru fan-out (4 workers)** | **51 ms** | **3.4x faster** |

<details>
<summary>Bun results</summary>

| Approach | Time | vs Sequential |
| --- | --: | --: |
| Sequential (no channels) | 59 ms | baseline |
| Main-thread channels only | 60 ms | 1.0x |
| **puru fan-out (4 workers)** | **22 ms** | **2.7x faster** |

</details>

### Concurrent Async

100 async tasks with simulated I/O + CPU, running off the main thread:

| Approach | Time | vs Sequential |
| --- | --: | --: |
| Sequential | 1,140 ms | baseline |
| **puru concurrent** | **16 ms** | **73x faster** |

<details>
<summary>Bun results</summary>

| Approach | Time | vs Sequential |
| --- | --: | --: |
| Sequential | 1,110 ms | baseline |
| **puru concurrent** | **13 ms** | **87x faster** |

</details>

> Spawn overhead is ~0.1-0.5 ms. Use `spawn` for tasks > 5ms. For trivial operations, call directly.

## Runtimes

| Runtime | Support | How |
| --- | --- | --- |
| Node.js >= 18 | Full | `worker_threads` |
| Bun | Full | Web Workers (file-based) |
| Deno | Planned | — |
| Cloudflare Workers | Error | No thread support |
| Vercel Edge | Error | No thread support |

## Testing

```typescript
import { configure } from '@dmop/puru'
configure({ adapter: 'inline' }) // runs tasks in main thread, no real workers
```

## Limitations

- Functions passed to `spawn()` cannot capture variables from the enclosing scope
- Channel values must be structured-cloneable (no functions, symbols, or WeakRefs)
- `null` cannot be sent through a channel (it's the "closed" sentinel)
- `register()`/`run()` args must be JSON-serializable
- Channel operations from workers have ~0.1-0.5ms RPC overhead per send/recv (fine for coarse-grained coordination, not for per-item micro-operations)

## License

MIT
