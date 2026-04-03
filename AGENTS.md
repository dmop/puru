# puru — Guide for AI Assistants

puru is a thread pool library for JavaScript with Go-style concurrency primitives (channels, WaitGroup, select). It runs functions off the main thread with no worker files and no boilerplate.

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

### Multiple tasks in parallel (WaitGroup)

```typescript
import { WaitGroup } from '@dmop/puru'

const items = [1, 2, 3, 4]
const wg = new WaitGroup()

for (const item of items) {
  const value = item // capture as a literal for each iteration
  wg.spawn(() => {
    // `value` is NOT captured from closure — this won't work
    // you must inline or use register()/run()
  })
}
```

To pass per-task data, use `register`/`run`:

```typescript
import { register, run, WaitGroup } from '@dmop/puru'

// Register once at startup
register('processItem', (item: number) => item * 2)

const items = [1, 2, 3, 4]
const wg = new WaitGroup()
for (const item of items) {
  wg.spawn(() => run('processItem', item))
}
const results = await wg.wait()
```

### Concurrent I/O (concurrent mode)

```typescript
import { WaitGroup } from '@dmop/puru'

const urls = ['https://...', 'https://...']
const wg = new WaitGroup()

for (const url of urls) {
  wg.spawn(() => run('fetchUrl', url), { concurrent: true })
}

register('fetchUrl', (url: string) => fetch(url).then(r => r.json()))
const results = await wg.wait()
```

### Cancel on first error (ErrGroup)

```typescript
import { ErrGroup, register } from '@dmop/puru'

register('fetchUser', (id: number) => fetch(`/api/users/${id}`).then(r => r.json()))
register('fetchOrders', (id: number) => fetch(`/api/orders/${id}`).then(r => r.json()))

const eg = new ErrGroup()
eg.spawn(() => run('fetchUser', 1))
eg.spawn(() => run('fetchOrders', 1))

const [user, orders] = await eg.wait() // throws on first error, cancels the rest
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

- Node.js >= 18: full support
- Bun: full support
- Deno: planned
- Cloudflare Workers / Vercel Edge: not supported (no thread API)
