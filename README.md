# puru (プール)

> A thread pool for JavaScript with Go-style concurrency primitives.
>
> Run work off the main thread with inline functions, channels, `WaitGroup`, `ErrGroup`, `select`, `Mutex`, `Once`, and more. No worker files. No boilerplate.

`puru` is for the moment when `Promise.all()` is no longer enough, but raw `worker_threads` feels too low-level.

- CPU-heavy work: use dedicated worker threads
- Async / I/O-heavy work: share worker threads efficiently with `concurrent: true`
- Coordination: use channels, `WaitGroup`, `ErrGroup`, `select`, `Mutex`, `Once`, and `ticker`
- Ergonomics: write worker logic inline or define reusable typed tasks

Works on **Node.js >= 20** and **Bun**.

## Why This Exists

JavaScript apps usually hit one of these walls:

- A request handler does 200ms of CPU work and stalls the event loop
- You want worker threads, but you do not want separate worker files and message plumbing
- You need more than raw parallelism: cancellation, fan-out, backpressure, coordination
- You like Go's concurrency model and want something similar in JavaScript

`puru` gives you a managed worker pool with a much nicer programming model.

## Install

```bash
npm install @dmop/puru
# or
bun add @dmop/puru
```

## 30-Second Tour

```ts
import { spawn, task, WaitGroup, chan } from '@dmop/puru'

// 1. One CPU-heavy task on a dedicated worker
const { result: fib } = spawn(() => {
  function fibonacci(n: number): number {
    if (n <= 1) return n
    return fibonacci(n - 1) + fibonacci(n - 2)
  }
  return fibonacci(40)
})

// 2. Reusable typed worker function
const resize = task((width: number, height: number) => {
  return { width, height, pixels: width * height }
})

// 3. Structured concurrency
const wg = new WaitGroup()
wg.spawn(() => {
  let sum = 0
  for (let i = 0; i < 1_000_000; i++) sum += i
  return sum
})
wg.spawn(
  () => fetch('https://api.example.com/users/1').then((r) => r.json()),
  { concurrent: true },
)

// 4. Channels for coordination
const jobs = chan<number>(10)
spawn(async ({ jobs }) => {
  for (let i = 0; i < 10; i++) await jobs.send(i)
  jobs.close()
}, { channels: { jobs }, concurrent: true })

console.log(await fib)
console.log(await resize(800, 600))
console.log(await wg.wait())
```

## The Big Rule

Functions passed to `spawn()` are serialized with `.toString()` and executed in a worker.

That means they **cannot capture variables from the enclosing scope**.

```ts
const x = 42

spawn(() => x + 1) // ReferenceError at runtime

spawn(() => {
  const x = 42
  return x + 1
}) // works
```

If you need to pass arguments repeatedly, prefer `task(fn)`.

## Why People Reach for puru

### Inline worker code

No separate worker file in the normal case.

```ts
import { spawn } from '@dmop/puru'

const { result } = spawn(() => {
  let sum = 0
  for (let i = 0; i < 10_000_000; i++) sum += i
  return sum
})
```

### Two execution modes

| Mode | Use it for | What happens |
| --- | --- | --- |
| `spawn(fn)` | CPU-bound work | The task gets a dedicated worker |
| `spawn(fn, { concurrent: true })` | Async / I/O-heavy work | Multiple tasks share a worker's event loop |

This is the key distinction:

- `exclusive` mode is for actual CPU parallelism
- `concurrent` mode is for lots of tasks that mostly `await`

### More than a worker pool

`puru` is not just `spawn()`.

- `chan()` for cross-thread coordination and backpressure
- `WaitGroup` for “run many, wait for all”
- `ErrGroup` for “fail fast, cancel the rest”
- `select()` for first-ready coordination
- `Mutex` for shared resource protection
- `Once` for one-time initialization under concurrency
- `task()` for reusable typed worker functions

## When To Use What

| Situation | Best tool |
| --- | --- |
| One heavy synchronous task | `spawn(fn)` |
| Same worker logic called many times with different inputs | `task(fn)` |
| Many async tasks that mostly wait on I/O | `spawn(fn, { concurrent: true })` |
| Parallel batch with “wait for everything” | `WaitGroup` |
| Parallel batch where the first failure should cancel the rest | `ErrGroup` |
| Producer/consumer or fan-out/fan-in pipeline | `chan()` |
| Non-blocking coordination between async operations | `select()` |

## Why Not Just Use...

### `Promise.all()`

Use `Promise.all()` when work is already cheap and async.

Use `puru` when:

- work is CPU-heavy
- you need the main thread to stay responsive under load
- you want worker coordination primitives, not just promise aggregation

### `worker_threads`

Raw `worker_threads` are powerful, but they are low-level:

- separate worker entry files
- manual message passing
- manual pooling
- no built-in channels, `WaitGroup`, `ErrGroup`, or `select`

`puru` keeps the power and removes most of the ceremony.

### Cluster

Cluster solves a different problem.

- Cluster: more processes, better request throughput
- `puru`: offload heavy work inside each process

They work well together.

## Feature Snapshot

| Feature | `puru` |
| --- | --- |
| Inline worker functions | Yes |
| Dedicated CPU workers | Yes |
| Shared-worker async mode | Yes |
| Channels across workers | Yes |
| WaitGroup / ErrGroup | Yes |
| `select` / timers | Yes |
| Mutex / Once | Yes |
| Bun support | Yes |
| TypeScript support | Yes |

## Performance

`puru` is designed for real work, not micro-bench tricks.

- Spawn overhead is roughly `0.1-0.5ms`
- As a rule of thumb, use worker threads for tasks above `~5ms`
- CPU-bound benchmarks show real speedups from multi-core execution
- Concurrent async benchmarks show large gains when many tasks mostly wait on I/O off the main thread

Full benchmark tables live in [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

## Docs

- [API reference](docs/API.md)
- [Benchmarks](docs/BENCHMARKS.md)
- [Production use cases](USE-CASES.md)
- [Examples](examples)
- [AI assistant guide](AGENTS.md)
- [Full LLM reference](llms-full.txt)

## Runtimes

| Runtime | Support | Notes |
| --- | --- | --- |
| Node.js >= 20 | Full | Uses `worker_threads` |
| Bun | Full | Uses Web Workers |
| Deno | Planned | Not yet implemented |

## Testing

Use the inline adapter to run tasks on the main thread in tests:

```ts
import { configure } from '@dmop/puru'

configure({ adapter: 'inline' })
```

## Limitations

- `spawn()` functions cannot capture outer variables
- Channel values must be structured-cloneable
- `null` is reserved as the channel closed sentinel
- `task()` arguments must be JSON-serializable
- Channel ops from workers have RPC overhead, so use them for coordination, not ultra-fine-grained inner loops

## License

MIT
