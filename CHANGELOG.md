# Changelog

## [0.1.0] - 2026-04-03

### Added

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
- Full Node.js >= 18 support via `worker_threads`
- Full Bun support via Web Workers
- Inline adapter for testing (`configure({ adapter: 'inline' })`)
