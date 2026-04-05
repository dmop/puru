# API Reference

This page is the exact API surface. If you want help deciding which primitive to use first, start with [Choosing the Right Primitive](./CHOOSING-PRIMITIVES.md). For implementation details, see [How puru Works](./HOW-IT-WORKS.md).

## `spawn(fn, opts?)`

Run a function in a worker thread. Returns:

```ts
{ result: Promise<T>, cancel: () => void }
```

### Options

- `concurrent?: boolean` — share a worker's event loop (default: `false`)
- `priority?: 'low' | 'normal' | 'high'` — task priority (default: `'normal'`)
- `channels?: Record<string, Channel>` — channels to pass to the worker
- `ctx?: Context` — context for automatic cancellation. When the context is cancelled, the task is cancelled too.

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

### Context integration

```ts
import { spawn, background, withTimeout } from '@dmop/puru'

const [ctx, cancel] = withTimeout(background(), 5000)
const { result } = spawn(() => {
  let total = 0
  for (let i = 0; i < 1_000_000; i++) total += i
  return total
}, { ctx })
// task auto-cancels if context expires
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
console.log(ch.len)          // 0 (buffer is empty after recv)
console.log(ch.cap)          // 10

ch.close()
console.log(await ch.recv()) // null
```

### `ch.len` / `ch.cap`

Inspect channel state. Like Go's `len(ch)` and `cap(ch)`.

- `len` — number of values currently buffered
- `cap` — buffer capacity

### `ch.sendOnly()` / `ch.recvOnly()`

Return directional views of a channel. Like Go's `chan<- T` and `<-chan T`.

```ts
function producer(ch: SendOnly<number>) {
  await ch.send(42) // OK
  // ch.recv()       // type error: recv doesn't exist on SendOnly
}

function consumer(ch: RecvOnly<number>) {
  const v = await ch.recv() // OK
  // ch.send(1)              // type error: send doesn't exist on RecvOnly
}

const ch = chan<number>(10)
producer(ch.sendOnly())
consumer(ch.recvOnly())
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

Accepts an optional `Context` — when the context is cancelled, all tasks are cancelled.

```ts
import { WaitGroup, background, withTimeout } from '@dmop/puru'

// With context: auto-cancel all tasks after 5s
const [ctx, cancel] = withTimeout(background(), 5000)
const wg = new WaitGroup(ctx)

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
cancel() // cleanup
```

## `ErrGroup`

Like `WaitGroup`, but cancels all remaining tasks on the first failure — in-flight workers are terminated and queued tasks are discarded.

Accepts an optional `Context`. Supports `setLimit()` to throttle concurrent tasks.

```ts
import { ErrGroup } from '@dmop/puru'

const eg = new ErrGroup()

eg.spawn(() => fetch('https://api.example.com/users/1').then((r) => r.json()), { concurrent: true })
eg.spawn(() => fetch('https://api.example.com/users/1/orders').then((r) => r.json()), { concurrent: true })

const [user, orders] = await eg.wait()
```

### `eg.setLimit(n)`

Limit the maximum number of tasks running concurrently. Like Go's `errgroup.SetLimit()`. Must be called before any `spawn()`.

```ts
const eg = new ErrGroup()
eg.setLimit(2) // max 2 tasks in flight at once

eg.spawn(() => fetch('https://api.example.com/a').then((r) => r.json()), { concurrent: true })
eg.spawn(() => fetch('https://api.example.com/b').then((r) => r.json()), { concurrent: true })
eg.spawn(() => fetch('https://api.example.com/c').then((r) => r.json()), { concurrent: true })
eg.spawn(() => fetch('https://api.example.com/d').then((r) => r.json()), { concurrent: true })

const results = await eg.wait() // runs at most 2 at a time
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

## `RWMutex`

Read-write mutex. Multiple readers can hold the lock simultaneously, but writers get exclusive access. Like Go's `sync.RWMutex`.

Use this instead of `Mutex` when reads vastly outnumber writes.

```ts
import { RWMutex } from '@dmop/puru'

const rw = new RWMutex()

// Multiple readers can run concurrently
const data = await rw.withRLock(async () => {
  return await cache.get('config')
})

// Writers get exclusive access
await rw.withLock(async () => {
  await cache.set('config', newValue)
})
```

Methods:

- `rLock()` / `rUnlock()` — acquire/release a read lock
- `lock()` / `unlock()` — acquire/release a write lock
- `withRLock(fn)` — read lock with auto-release
- `withLock(fn)` — write lock with auto-release
- `isLocked` — `true` if any lock (read or write) is held

## `Once<T>`

Run a function exactly once, even under concurrent calls.

```ts
import { Once } from '@dmop/puru'

const once = new Once<DBConnection>()
const conn = await once.do(() => createExpensiveConnection())
```

## `select(cases, opts?)`

Wait for the first of multiple async operations, like Go's `select`.

Supports both recv and send cases:

```ts
// Recv case — handler receives the value
await select([
  [ch.recv(), (value) => console.log('received', value)],
  [after(5000), () => console.log('timeout')],
])

// Send case — handler is called when send completes
await select([
  [ch.send(42), () => console.log('sent!')],
  [after(1000), () => console.log('send timed out')],
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

## `Timer`

A resettable one-shot timer. Like Go's `time.Timer`.

Unlike `after()` which is fire-and-forget, `Timer` can be stopped and reset without allocating new objects.

```ts
import { Timer } from '@dmop/puru'

const t = new Timer(5000)

// Use with select
await select([
  [ch.recv(), (v) => { t.stop(); handle(v) }],
  [t.channel, () => console.log('timed out')],
])

// Reset for reuse (e.g., debounce)
t.reset(300)
await t.channel
```

- `t.channel` — promise that resolves when the timer fires
- `t.stop()` — cancel the timer, returns `true` if it was pending
- `t.reset(ms)` — stop and reschedule, creates a new `channel` promise
- `t.stopped` — whether the timer has fired or been stopped

## `Cond`

Condition variable for async coordination. Like Go's `sync.Cond`.

Associates with a `Mutex`. Tasks can wait for a condition and be woken by `signal()` (one) or `broadcast()` (all).

```ts
import { Mutex, Cond } from '@dmop/puru'

const mu = new Mutex()
const cond = new Cond(mu)
let ready = false

// Waiter (runs in an async context)
await mu.lock()
while (!ready) {
  await cond.wait() // releases lock, waits, re-acquires lock
}
mu.unlock()

// Signaler (from another async context)
await mu.lock()
ready = true
cond.signal()   // wake one waiter
// cond.broadcast() // or wake all waiters
mu.unlock()
```

## Context

Hierarchical cancellation, deadlines, and request-scoped values — modeled after Go's `context` package.

### `background()`

Returns the root context. It is never cancelled, has no deadline, and carries no values. All other contexts should derive from this.

```ts
import { background } from '@dmop/puru'

const root = background()
```

### `withCancel(parent)`

Returns a child context and a cancel function. Cancelling the child also cancels all contexts derived from it. The child cancels when the parent does.

```ts
import { background, withCancel } from '@dmop/puru'

const [ctx, cancel] = withCancel(background())

// Later...
cancel() // or cancel('shutting down')
console.log(ctx.err) // CancelledError
```

### `withTimeout(parent, ms)`

Returns a child context that auto-cancels after `ms` milliseconds. The returned cancel function can cancel early and clears the timer.

```ts
import { background, withTimeout } from '@dmop/puru'

const [ctx, cancel] = withTimeout(background(), 5000)

ctx.done().then(() => console.log('timed out or cancelled'))
ctx.deadline // Date ~5s from now

cancel() // cancel early, clears the timer
```

### `withDeadline(parent, deadline)`

Returns a child context that auto-cancels at the given `Date`. If the parent has an earlier deadline, that deadline is inherited.

```ts
import { background, withDeadline } from '@dmop/puru'

const deadline = new Date(Date.now() + 10_000)
const [ctx, cancel] = withDeadline(background(), deadline)
```

### `withValue(parent, key, value)`

Returns a child context carrying a key-value pair. Values are looked up through the ancestor chain.

```ts
import { background, withValue } from '@dmop/puru'

const ctx = withValue(background(), 'requestId', 'abc-123')
ctx.value('requestId') // 'abc-123'
ctx.value('missing')   // undefined
```

### Context interface

```ts
interface Context {
  readonly signal: AbortSignal      // fires when cancelled or deadline expires
  readonly deadline: Date | null    // deadline if set, null otherwise
  readonly err: ContextError | null // CancelledError or DeadlineExceededError, null if active
  value<T>(key: symbol | string): T | undefined
  done(): Promise<void>             // resolves when cancelled
}

type CancelFunc = (reason?: string) => void
```

### Error types

- `CancelledError` — returned by `ctx.err` when the context was explicitly cancelled
- `DeadlineExceededError` — returned by `ctx.err` when the deadline has passed

---

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

These are advanced operational APIs. Most applications can configure the pool once at startup and never call them again.

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
