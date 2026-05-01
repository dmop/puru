---
id: intro
title: Introduction
sidebar_position: 1
slug: /intro
---

# puru (プール)

**Go-style concurrency and parallelism for JavaScript.** Worker threads deliver true CPU **parallelism** across cores. Go-style `chan`, `WaitGroup`, `ErrGroup`, `select`, and `context` manage **concurrency** — zero dependencies, no worker files, no boilerplate.

```ts
import { spawn } from '@dmop/puru'

const { result } = spawn(() => {
  let sum = 0
  for (let i = 0; i < 100_000_000; i++) sum += i
  return sum
})

console.log(await result) // runs off the main thread
```

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

## Two Modes

| Mode | Kind | Use it for | What happens |
| --- | --- | --- | --- |
| `spawn(fn)` | **Parallelism** | CPU-bound work | Dedicated worker thread — runs on a separate CPU core |
| `spawn(fn, { concurrent: true })` | **Concurrency** | Async / I/O work | Shares a worker's event loop (M:N scheduling) |

## What's Included

**Coordination:** `chan()` · `WaitGroup` · `ErrGroup` · `select()` · `context`

**Synchronization:** `Mutex` · `RWMutex` · `Once` · `Cond`

**Timing:** `after()` · `ticker()` · `Timer`

**Ergonomics:** `task()` · `configure()` · `stats()` · directional channels · channel `len`/`cap`

All modeled after Go's concurrency primitives.

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
