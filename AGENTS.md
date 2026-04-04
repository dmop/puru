# puru — Guide for AI Assistants

puru is a thread pool library for JavaScript with Go-style concurrency primitives (channels, WaitGroup, ErrGroup, select, context, Mutex, RWMutex, Cond, Timer). It runs functions off the main thread with no worker files and no boilerplate.

Full API reference: https://raw.githubusercontent.com/dmop/puru/main/llms-full.txt

## Install

```bash
npm install @dmop/puru
# or
bun add @dmop/puru
```

## The Most Important Rule

Functions passed to `spawn()` are serialized via `.toString()` and sent to a worker thread. **They cannot access variables from the outer scope.**

```typescript
// WRONG — closes over `data`, will throw ReferenceError at runtime
const data = { id: 1 }
spawn(() => processData(data))

// WRONG — closes over `processData` imported in the outer file
import { processData } from './utils'
spawn(() => processData({ id: 1 }))

// RIGHT — inline everything the function needs
spawn(() => {
  function processData(d: { id: number }) {
    return d.id * 2
  }
  return processData({ id: 1 })
})

// RIGHT — inline the data as a literal
spawn(() => {
  const data = { id: 1 }
  return data.id * 2
})
```

Helper functions used inside `spawn()` must also be defined inside the function body:

```typescript
// WRONG
function fibonacci(n: number): number {
  if (n <= 1) return n
  return fibonacci(n - 1) + fibonacci(n - 2)
}
spawn(() => fibonacci(40)) // ReferenceError: fibonacci is not defined

// RIGHT
spawn(() => {
  function fibonacci(n: number): number {
    if (n <= 1) return n
    return fibonacci(n - 1) + fibonacci(n - 2)
  }
  return fibonacci(40)
})
```

## Common Patterns

### CPU-bound work (exclusive mode)

```typescript
import { spawn } from '@dmop/puru'

const { result } = spawn(() => {
  // define everything you need inside
  function crunch(n: number) {
    let sum = 0
    for (let i = 0; i < n; i++) sum += i
    return sum
  }
  return crunch(1_000_000)
})

console.log(await result)
```

### Multiple tasks in parallel (`task()`)

```typescript
import { task } from '@dmop/puru'

const items = [1, 2, 3, 4]
const processItem = task((item: number) => item * 2)
const results = await Promise.all(items.map((item) => processItem(item)))
```

### Concurrent I/O (concurrent mode)

```typescript
import { spawn } from '@dmop/puru'

const user = spawn(
  () => fetch('https://api.example.com/users/1').then((r) => r.json()),
  { concurrent: true },
)

const orders = spawn(
  () => fetch('https://api.example.com/users/1/orders').then((r) => r.json()),
  { concurrent: true },
)

const results = await Promise.all([user.result, orders.result])
```

### Cancel on first error (ErrGroup)

```typescript
import { ErrGroup } from '@dmop/puru'

const eg = new ErrGroup()
eg.spawn(() => fetch('https://api.example.com/users/1').then((r) => r.json()), { concurrent: true })
eg.spawn(() => fetch('https://api.example.com/users/1/orders').then((r) => r.json()), { concurrent: true })

const [user, orders] = await eg.wait() // throws on first error, cancels the rest
```

### ErrGroup with concurrency limit

```typescript
import { ErrGroup } from '@dmop/puru'

const eg = new ErrGroup()
eg.setLimit(4) // max 4 tasks in flight at once

for (const url of urls) {
  eg.spawn(() => fetch(url).then(r => r.json()), { concurrent: true })
}

const results = await eg.wait()
```

### Context-integrated spawn (auto-cancel)

```typescript
import { spawn, background, withTimeout } from '@dmop/puru'

// Task auto-cancels when context expires — no manual wiring needed
const [ctx, cancel] = withTimeout(background(), 5000)
const { result } = spawn(() => heavyWork(), { ctx })

try {
  console.log(await result)
} finally {
  cancel()
}
```

### Context with WaitGroup / ErrGroup

```typescript
import { background, withTimeout, WaitGroup } from '@dmop/puru'

const [ctx, cancel] = withTimeout(background(), 5000)

// Pass context to WaitGroup — all tasks auto-cancel when ctx expires
const wg = new WaitGroup(ctx)
wg.spawn(() => { /* CPU work */ return 42 })
wg.spawn(() => fetch('https://api.example.com/data').then(r => r.json()), { concurrent: true })

try {
  const results = await wg.wait()
} catch {
  console.log('timed out or cancelled')
} finally {
  cancel()
}
```

### RWMutex (read-write lock)

```typescript
import { RWMutex } from '@dmop/puru'

const rw = new RWMutex()

// Many readers can run concurrently
const data = await rw.withRLock(() => cache.get('config'))

// Writers get exclusive access
await rw.withLock(() => cache.set('config', newValue))
```

### Timer (resettable one-shot)

```typescript
import { Timer, select } from '@dmop/puru'

const t = new Timer(5000)

// Use with select for cancellable timeouts
await select([
  [ch.recv(), (v) => { t.stop(); handle(v) }],
  [t.channel, () => console.log('timed out')],
])

// Reset for debounce patterns
t.reset(300)
```

### Cond (condition variable)

```typescript
import { Mutex, Cond } from '@dmop/puru'

const mu = new Mutex()
const cond = new Cond(mu)
let ready = false

// Waiter
await mu.lock()
while (!ready) await cond.wait()
mu.unlock()

// Signaler
await mu.lock()
ready = true
cond.broadcast() // wake all waiters
mu.unlock()
```

### Directional channels

```typescript
import { chan } from '@dmop/puru'
import type { SendOnly, RecvOnly } from '@dmop/puru'

const ch = chan<number>(10)

function producer(out: SendOnly<number>) {
  await out.send(42)
  out.close()
}

function consumer(inp: RecvOnly<number>) {
  for await (const v of inp) console.log(v)
}

producer(ch.sendOnly())
consumer(ch.recvOnly())
```

### Channel inspection

```typescript
const ch = chan<number>(100)
await ch.send(1)
await ch.send(2)
console.log(ch.len) // 2 (buffered values)
console.log(ch.cap) // 100 (buffer capacity)
```

### Cross-thread channels (fan-out)

```typescript
import { chan, spawn } from '@dmop/puru'

const input = chan<number>(50)
const output = chan<number>(50)

// 4 worker threads pulling from the same channel
for (let i = 0; i < 4; i++) {
  spawn(async ({ input, output }) => {
    for await (const n of input) {
      await output.send(n * 2)
    }
  }, { channels: { input, output } })
}

// Producer
for (let i = 0; i < 100; i++) await input.send(i)
input.close()

// Consume results
for await (const result of output) {
  console.log(result)
}
```

## What Can Be Sent Through Channels

Channel values must be **structured-cloneable**:

```typescript
// OK
ch.send(42)
ch.send('hello')
ch.send({ id: 1, name: 'foo' })
ch.send([1, 2, 3])

// NOT OK — will throw
ch.send(() => {})        // functions
ch.send(Symbol('x'))     // symbols
ch.send(new WeakRef({})) // WeakRefs
ch.send(null)            // null is the "closed" sentinel — use undefined instead
```

## Testing

Use the inline adapter so tests run on the main thread without real workers:

```typescript
import { configure } from '@dmop/puru'

// In your test setup file
configure({ adapter: 'inline' })
```

## Runtimes

- Node.js >= 20: full support
- Bun: full support
- Deno: planned
- Cloudflare Workers / Vercel Edge: not supported (no thread API)
