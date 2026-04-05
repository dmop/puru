# puru (プール)

[![npm version](https://img.shields.io/npm/v/@dmop/puru)](https://www.npmjs.com/package/@dmop/puru)
[![npm downloads](https://img.shields.io/npm/dm/@dmop/puru)](https://www.npmjs.com/package/@dmop/puru)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@dmop/puru)](https://bundlephobia.com/package/@dmop/puru)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/@dmop/puru?activeTab=dependencies)
[![license](https://img.shields.io/npm/l/@dmop/puru)](LICENSE)

**Go-style concurrency for JavaScript.** Run CPU-heavy or I/O-heavy work off the main thread with channels, `WaitGroup`, `ErrGroup`, `select`, and `context` — zero dependencies, no worker files, no boilerplate.

```ts
import { spawn } from '@dmop/puru'

const { result } = spawn(() => {
  let sum = 0
  for (let i = 0; i < 100_000_000; i++) sum += i
  return sum
})

console.log(await result) // runs off the main thread
```

## Before / After

<table>
<tr><th>Raw worker_threads</th><th>puru</th></tr>
<tr>
<td>

```ts
const { Worker } = require('worker_threads')
const worker = new Worker('./worker.js')
worker.postMessage({ n: 40 })
worker.on('message', (result) => {
  console.log(result)
  worker.terminate()
})
worker.on('error', reject)

// worker.js (separate file)
const { parentPort } = require('worker_threads')
parentPort.on('message', ({ n }) => {
  parentPort.postMessage(fibonacci(n))
})
```

</td>
<td>

```ts
import { spawn } from '@dmop/puru'

const { result } = spawn(() => {
  function fibonacci(n: number): number {
    if (n <= 1) return n
    return fibonacci(n - 1) + fibonacci(n - 2)
  }
  return fibonacci(40)
})

try {
  console.log(await result)
} catch (err) {
  console.error(err)
}
```

</td>
</tr>
</table>

One file. No message plumbing. Automatic pooling.

## Install

Zero runtime dependencies — just the library itself.

```bash
npm install @dmop/puru
# or
bun add @dmop/puru
```

## Quick Start

```ts
import { spawn, WaitGroup, chan, task } from '@dmop/puru'

// CPU work on a dedicated worker
const { result } = spawn(() => {
  function fibonacci(n: number): number {
    if (n <= 1) return n
    return fibonacci(n - 1) + fibonacci(n - 2)
  }
  return fibonacci(40)
})

// Reusable worker logic with explicit arguments
const crunch = task((n: number) => {
  let sum = 0
  for (let i = 0; i < n; i++) sum += i
  return sum
})

// Parallel batch — wait for all
const wg = new WaitGroup()
wg.spawn(() => 21 * 2)
wg.spawn(() => 6 * 7)
const [a, b] = await wg.wait()

const bigNumber = await result
const heavySum = await crunch(1_000_000)
console.log({ a, b, bigNumber, heavySum })

// Cross-thread channels
const ch = chan<number>(10)
spawn(async ({ ch }) => {
  for (let i = 0; i < 10; i++) await ch.send(i)
  ch.close()
}, { channels: { ch } })

for await (const item of ch) console.log(item)
```

## Performance

Measured on Apple M1 Pro (8 cores). Full results in [BENCHMARKS.md](docs/BENCHMARKS.md).

| Benchmark | Single-threaded | puru | Speedup |
| --- | --: | --: | --: |
| Fibonacci (fib(38) x8) | 4,345 ms | 2,131 ms | **2.0x** |
| Prime counting (2M range) | 335 ms | 77 ms | **4.4x** |
| 100 concurrent async tasks | 1,140 ms | 16 ms | **73x** |
| Fan-out pipeline (4 workers) | 176 ms | 51 ms | **3.4x** |

Spawn overhead: ~0.1-0.5ms. Use for tasks above ~5ms.

## Two Modes

| Mode | Use it for | What happens |
| --- | --- | --- |
| `spawn(fn)` | CPU-bound work | Dedicated worker thread |
| `spawn(fn, { concurrent: true })` | Async / I/O work | Shares a worker's event loop |

## When To Use What

| Situation | Tool |
| --- | --- |
| One heavy CPU task | `spawn(fn)` |
| Same logic, many inputs | `task(fn)` |
| Wait for all tasks | `WaitGroup` |
| Fail-fast, cancel the rest | `ErrGroup` (with `setLimit()` for throttling) |
| Timeouts and cancellation | `context` + `spawn(fn, { ctx })` |
| Producer/consumer pipelines | `chan()` + `select()` |

## The Big Rule

> **Functions passed to `spawn()` cannot capture outer variables.** They are serialized as text and sent to a worker — closures don't survive.

```ts
const x = 42
spawn(() => x + 1)          // ReferenceError at runtime

spawn(() => {
  const x = 42               // define inside
  return x + 1
})                            // works
```

Use `task(fn)` to pass arguments to reusable worker functions.

## What's Included

**Coordination:** `chan()` &middot; `WaitGroup` &middot; `ErrGroup` &middot; `select()` &middot; `context`

**Synchronization:** `Mutex` &middot; `RWMutex` &middot; `Once` &middot; `Cond`

**Timing:** `after()` &middot; `ticker()` &middot; `Timer`

**Ergonomics:** `task()` &middot; `configure()` &middot; `stats()` &middot; directional channels &middot; channel `len`/`cap`

All modeled after Go's concurrency primitives. Full API in [docs/API.md](docs/API.md).

## Why Not Just Use...

**`Promise.all()`** — Great for cheap async work. Use puru when work is CPU-heavy or you need the main thread to stay responsive.

**`worker_threads`** — Powerful but low-level: separate files, manual messaging, manual pooling, no channels/WaitGroup/select. puru keeps the power, removes the ceremony.

**Cluster** — Cluster adds processes for request throughput. puru offloads heavy work inside each process. They compose well together.

## Runtimes

| Runtime | Status |
| --- | --- |
| Node.js >= 20 | Full support |
| Bun | Full support |
| Deno | Planned |

## Testing

```ts
import { configure } from '@dmop/puru'
configure({ adapter: 'inline' }) // runs on main thread, no real workers
```

## Docs

- [Choosing the right primitive](docs/CHOOSING-PRIMITIVES.md)
- [API reference](docs/API.md)
- [How it works](docs/HOW-IT-WORKS.md)
- [Benchmarks](docs/BENCHMARKS.md)
- [Production use cases](docs/USE-CASES.md)
- [Examples](examples)
- [AI assistant guide](AGENTS.md)

## Limitations

- `spawn()` functions cannot capture outer variables (see [The Big Rule](#the-big-rule))
- Channel values must be structured-cloneable (no functions, symbols, WeakRefs)
- `null` is reserved as the channel-closed sentinel
- `task()` arguments must be JSON-serializable

## License

MIT
