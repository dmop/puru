# Changelog

## Unreleased

### Added

- `spawn()` now accepts `{ ctx }` option — tasks auto-cancel when the context is cancelled
- `WaitGroup` and `ErrGroup` constructors accept an optional `Context` for automatic cancellation
- `ErrGroup.setLimit(n)` — limit the maximum number of concurrent tasks (Go's `errgroup.SetLimit()`)
- `RWMutex` — read-write mutex allowing concurrent readers with exclusive writers (Go's `sync.RWMutex`)
- `Timer` — resettable one-shot timer with `stop()` and `reset()` (Go's `time.Timer`)
- `Cond` — condition variable with `wait()`, `signal()`, and `broadcast()` (Go's `sync.Cond`)
- `Channel.len` / `Channel.cap` — inspect buffer state (Go's `len(ch)` / `cap(ch)`)
- `Channel.sendOnly()` / `Channel.recvOnly()` — directional channel views for type safety (Go's `chan<- T` / `<-chan T`)
- `select()` now supports send cases alongside recv cases

## [0.1.0] - 2026-04-03

### Initial release

- `spawn(fn, opts?)` — run functions in worker threads with automatic pool management
- Thread pool with two dispatch modes:
  - **Exclusive** (default) — 1 task per thread, optimal for CPU-bound work
  - **Concurrent** (`{ concurrent: true }`) — many tasks share threads, optimal for async/I/O work
- `chan(capacity?)` — Go-style channels with send, recv, close, and async iteration
- **Channels in workers** — pass channels to `spawn()` via `{ channels: { name: ch } }` for cross-thread communication
- `WaitGroup` — structured concurrency with `spawn()`, `wait()`, `waitSettled()`, and `cancel()`
- `select(cases)` — wait for the first of multiple promises (Go-style select)
- `after(ms)` — promise-based timer, useful with `select` for timeouts
- `task(fn)` — reusable worker-thread functions with explicit arguments
- `configure(opts?)` — global pool configuration (maxThreads, concurrency, idleTimeout)
- `stats()` / `resize(n)` — pool inspection and dynamic resizing
- Task priority scheduling (high, normal, low)
- Task cancellation with `cancel()`
- Runtime detection (`detectRuntime()`, `detectCapability()`)
- Full Node.js >= 20 support via `worker_threads`
- Full Bun support via Web Workers
- Inline adapter for testing (`configure({ adapter: 'inline' })`)
