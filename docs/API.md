# API Reference

## `spawn(fn, opts?)`

Run a function in a worker thread. Returns:

```ts
{ result: Promise<T>, cancel: () => void }
```

### Example

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

### Modes

- Default: dedicated worker, best for CPU-heavy work
- `{ concurrent: true }`: shared worker event loop, best for async / I/O-heavy work

### Important rule

The function must be self-contained. It cannot capture variables from the enclosing scope.

```ts
const x = 42
spawn(() => x + 1) // fails
```

## `task(fn)`

Define a reusable worker-thread function with explicit arguments.

```ts
import { task } from '@dmop/puru'

const resizeImage = task((src: string, width: number, height: number) => {
  return { src, width, height }
})

const resized = await resizeImage('photo.jpg', 800, 600)
```

Use `task()` when the same worker logic will be called many times with different inputs.

## `chan(capacity?)`

Create a channel for communication between async tasks, including across workers.

```ts
import { chan } from '@dmop/puru'

const ch = chan<number>(10)

await ch.send(42)
console.log(await ch.recv()) // 42

ch.close()
console.log(await ch.recv()) // null
```

### In workers

```ts
import { chan, spawn } from '@dmop/puru'

const jobs = chan<number>(10)

spawn(async ({ jobs }) => {
  for (let i = 0; i < 10; i++) await jobs.send(i)
  jobs.close()
}, { channels: { jobs }, concurrent: true })
```

## `WaitGroup`

Structured concurrency: spawn multiple tasks, then wait for all of them.

```ts
import { WaitGroup } from '@dmop/puru'

const wg = new WaitGroup()

wg.spawn(() => {
  let sum = 0
  for (let i = 0; i < 1_000_000; i++) sum += i
  return sum
})

wg.spawn(
  () => fetch('https://api.example.com/data').then((r) => r.json()),
  { concurrent: true },
)

const results = await wg.wait()
const settled = await wg.waitSettled()
```

## `ErrGroup`

Like `WaitGroup`, but cancels the remaining tasks on the first failure.

```ts
import { ErrGroup } from '@dmop/puru'

const eg = new ErrGroup()

eg.spawn(() => fetch('https://api.example.com/users/1').then((r) => r.json()), { concurrent: true })
eg.spawn(() => fetch('https://api.example.com/users/1/orders').then((r) => r.json()), { concurrent: true })

const [user, orders] = await eg.wait()
```

## `Mutex`

Serialize access to a shared async resource.

```ts
import { Mutex } from '@dmop/puru'

const mu = new Mutex()

const result = await mu.withLock(async () => {
  return await db.query('UPDATE ...')
})
```

## `Once<T>`

Run a function exactly once, even under concurrent calls.

```ts
import { Once } from '@dmop/puru'

const once = new Once<DBConnection>()
const conn = await once.do(() => createExpensiveConnection())
```

## `select(cases, opts?)`

Wait for the first of multiple async operations, like Go's `select`.

```ts
await select([
  [ch.recv(), (value) => console.log('received', value)],
  [after(5000), () => console.log('timeout')],
])
```

With `default`, it becomes non-blocking.

## `after(ms)` / `ticker(ms)`

Timer helpers for use with `select` and async iteration.

```ts
await after(1000)

const t = ticker(500)
for await (const _ of t) {
  console.log('tick')
}
```

## `configure(opts?)`

Must be called before the first `spawn()`.

```ts
import { configure } from '@dmop/puru'

configure({
  maxThreads: 4,
  concurrency: 64,
  idleTimeout: 30_000,
  adapter: 'auto',
})
```

## `stats()` / `resize(n)`

Inspect and resize the pool.

```ts
const s = stats()
resize(8)
```

## `detectRuntime()` / `detectCapability()`

```ts
detectRuntime()     // 'node' | 'bun' | 'deno' | 'browser'
detectCapability()  // 'full-threads' | 'single-thread'
```

## Limits

- `spawn()` functions cannot capture enclosing variables
- Channel values must be structured-cloneable
- `null` cannot be sent through channels
- `task()` args must be JSON-serializable
