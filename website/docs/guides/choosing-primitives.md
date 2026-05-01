---
id: choosing-primitives
title: Choosing the Right Primitive
sidebar_position: 1
---

# Choosing The Right Primitive

When you know which tool to reach for, `puru` feels simple. Most confusion comes from using the right primitive for the wrong job.

This guide is the fast path.

For exact signatures, see the [API Reference](/docs/api). For deeper production examples, see [Production Use Cases](/docs/guides/use-cases).

## Start Here

Use this decision table first:

| If you need to... | Use |
| --- | --- |
| Run one heavy CPU-bound function off the main thread | `spawn(fn)` |
| Reuse the same worker function with many different inputs | `task(fn)` |
| Start several tasks and wait for all of them | `WaitGroup` |
| Cancel the rest as soon as one task fails | `ErrGroup` |
| Coordinate producers and consumers | `chan()` |
| Wait for whichever operation finishes first | `select()` |
| Add timeouts or cancellation | `background()` + `withTimeout()` / `withCancel()` |
| Protect shared async state | `Mutex` / `RWMutex` |
| Wake waiters when some condition becomes true | `Cond` |
| Run setup code only once | `Once` |

## `spawn(fn)`

Use `spawn()` for one-off work you want to move off the main thread.

Best for:

- CPU-heavy work like parsing, hashing, image transforms, compression, scoring, or math
- One task that does not need reusable arguments
- Cases where you want a simple `{ result, cancel }` handle

```ts
import { spawn } from '@dmop/puru'

const { result } = spawn(() => {
  function fibonacci(n: number): number {
    if (n <= 1) return n
    return fibonacci(n - 1) + fibonacci(n - 2)
  }
  return fibonacci(40)
})

console.log(await result)
```

Use `{ concurrent: true }` when the work is mostly async or I/O-bound:

```ts
const { result } = spawn(
  () => fetch('https://api.example.com/data').then((r) => r.json()),
  { concurrent: true },
)
```

### Important

Functions passed to `spawn()` are serialized and sent to a worker. They cannot capture variables from outer scope.

```ts
const url = 'https://api.example.com'
spawn(() => fetch(url)) // wrong
```

Instead, define everything inside the function or switch to `task()` when you need explicit arguments.

## `task(fn)`

Use `task()` when you have the same worker logic to call many times with different inputs.

Best for:

- Map-style processing over many items
- Reusable "worker function" APIs
- Cleaner call sites than inlining a new `spawn()` each time

```ts
import { task } from '@dmop/puru'

const parseUser = task((json: string) => JSON.parse(json))

const users = await Promise.all(rows.map((row) => parseUser(row)))
```

Choose `task()` over `spawn()` when the function is stable but the inputs change.

### Important

- `task()` arguments must be JSON-serializable
- The task function itself still must not capture outer variables

## `WaitGroup`

Use `WaitGroup` when several tasks belong together and you want to wait for all of them.

Best for:

- Parallel batch jobs
- Independent tasks where every result matters
- Workflows where partial success is acceptable via `waitSettled()`

```ts
import { WaitGroup } from '@dmop/puru'

const wg = new WaitGroup()
wg.spawn(() => 40 + 2)
wg.spawn(() => 6 * 7)

const results = await wg.wait()
```

If you want to inspect both successes and failures instead of throwing on the first rejection:

```ts
const settled = await wg.waitSettled()
```

## `ErrGroup`

Use `ErrGroup` when one failure should cancel the whole operation.

Best for:

- Multi-step fetches where partial data is useless
- Fan-out work where one failed branch invalidates the result
- Bounded concurrency with `setLimit()`

```ts
import { ErrGroup } from '@dmop/puru'

const eg = new ErrGroup()
eg.setLimit(2)
eg.spawn(() => fetch('https://api.example.com/a').then((r) => r.json()), { concurrent: true })
eg.spawn(() => fetch('https://api.example.com/b').then((r) => r.json()), { concurrent: true })
eg.spawn(() => fetch('https://api.example.com/c').then((r) => r.json()), { concurrent: true })

const results = await eg.wait()
```

Choose `ErrGroup` over `WaitGroup` when fail-fast behavior is the feature, not a side effect.

## `chan()` and `select()`

Use channels when tasks need to coordinate, stream values, or build pipelines.

Best for:

- Producer/consumer queues
- Worker fan-out or fan-in
- Pipelines where values arrive over time

```ts
import { chan, spawn } from '@dmop/puru'

const jobs = chan<number>(10)

spawn(async ({ jobs }) => {
  for (let i = 0; i < 10; i++) await jobs.send(i)
  jobs.close()
}, { channels: { jobs } })

for await (const n of jobs) {
  console.log(n)
}
```

Use `select()` when you need "whichever happens first" behavior:

```ts
import { after, select } from '@dmop/puru'

await select([
  [jobs.recv(), (job) => console.log(job)],
  [after(5000), () => console.log('timeout')],
])
```

## `context`

Use context when cancellation or deadlines are part of the job itself.

Best for:

- Request-scoped work
- Timeouts
- Automatic cancellation across related tasks

```ts
import { background, spawn, withTimeout } from '@dmop/puru'

const [ctx, cancel] = withTimeout(background(), 5000)
const { result } = spawn(() => {
  let total = 0
  for (let i = 0; i < 1_000_000; i++) total += i
  return total
}, { ctx })

try {
  await result
} finally {
  cancel()
}
```

## Synchronization Primitives

Use these when the problem is shared state, not worker orchestration.

### `Mutex`

Use when only one async operation should touch a resource at a time.

```ts
import { Mutex } from '@dmop/puru'

const mu = new Mutex()
await mu.withLock(() => writeToCache())
```

### `RWMutex`

Use when reads are frequent and writes are rare.

```ts
import { RWMutex } from '@dmop/puru'

const rw = new RWMutex()
const value = await rw.withRLock(() => cache.get('config'))
```

### `Cond`

Use when one task needs to wait for another to signal that a condition became true.

### `Once`

Use when expensive initialization should happen only once.

## Common Mistakes

### Capturing outer variables inside `spawn()` or `task()`

```ts
const factor = 2
spawn(() => 21 * factor) // wrong
```

Define `factor` inside the worker function or pass it as a `task()` argument.

### Using `spawn()` for many calls to the same logic

If you repeat the same worker body with different inputs, prefer `task()`.

### Using `WaitGroup` when you really want fail-fast cancellation

If one failed task should stop the others, use `ErrGroup`.

### Using channels for simple one-shot results

If you only need one result, `spawn()` or `task()` is simpler. Channels are for coordination, streaming, and pipelines.

## Rule Of Thumb

- `spawn()` for one job
- `task()` for one job shape with many inputs
- `WaitGroup` for wait-all
- `ErrGroup` for fail-fast
- `chan()` and `select()` for coordination
- `context` for cancellation and deadlines
- `Mutex` / `RWMutex` / `Cond` / `Once` for shared-state control
