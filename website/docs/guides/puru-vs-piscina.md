---
id: puru-vs-piscina
title: puru vs piscina
sidebar_position: 4
---

# puru vs piscina Performance Comparison

## What This Comparison Measures

These benchmarks compare four execution modes side by side:

- `Sequential (main thread)`: no worker pool, used as a baseline
- `puru spawn()`: inline worker function, serialized per call
- `puru task()`: worker function registered once, arguments sent per call
- `piscina`: preloaded worker-file pool with structured-clone arguments

That distinction matters:

- `spawn()` is the ergonomic path for one-off inline work
- `task()` is the hot-path API for repeated CPU-bound jobs
- `piscina` is also a repeated-work API, so `task()` is the fairest head-to-head comparison

## Runtime And Command

Machine used during this run:

- Apple Silicon, `availableParallelism() = 8`
- Node.js `v24.11.1`
- Bun `1.3.11`
- `@dmop/puru` `0.1.14`
- `piscina` `4.8.0`

## Node.js Results

### Scenario 1: CPU-bound `fib(38) x 8`

| Mode | Median | Relative to sequential |
| --- | ---: | ---: |
| Sequential (main thread) | 3695.7 ms | 1.00x |
| `puru spawn()` | 1889.1 ms | 1.96x faster |
| `puru task()` | 734.2 ms | 5.03x faster |
| `piscina` | 705.8 ms | 5.24x faster |

Takeaway: On repeated heavy CPU work in Node, `puru task()` and `piscina` are very close. In this run, `piscina` was about `1.04x` faster than `puru task()` on Fibonacci.

### Scenario 2: `200x200` matrix multiply `x 8`

| Mode | Median | Relative to sequential |
| --- | ---: | ---: |
| Sequential (main thread) | 130.3 ms | 1.00x |
| `puru spawn()` | 35.7 ms | 3.64x faster |
| `puru task()` | 41.3 ms | 3.16x faster |
| `piscina` | 56.6 ms | 2.30x faster |

Takeaway: For this medium CPU workload on Node, both `puru` worker modes beat `piscina` in the sampled median.

### Scenario 3: dispatch overhead, `1000` trivial tasks

| Mode | Median | Throughput |
| --- | ---: | ---: |
| Sequential (main thread) | 0.0 ms | 22,119,979 tasks/sec |
| `puru spawn()` | 15.6 ms | 64,149 tasks/sec |
| `puru task()` | 11.4 ms | 87,722 tasks/sec |
| `piscina` | 7.9 ms | 127,335 tasks/sec |

Takeaway: For tiny tasks, dispatch overhead dominates and `piscina` led this run. This is expected: trivial work is a poor fit for cross-thread scheduling, regardless of library.

## Bun Results

### Scenario 1: CPU-bound `fib(38) x 8`

| Mode | Median | Relative to sequential |
| --- | ---: | ---: |
| Sequential (main thread) | 1792.4 ms | 1.00x |
| `puru spawn()` | 414.8 ms | 4.32x faster |
| `puru task()` | 410.1 ms | 4.37x faster |
| `piscina` | 384.4 ms | 4.66x faster |

Takeaway: On Bun, `puru task()` again landed close to `piscina`, with `piscina` ahead by about `1.07x` in this Fibonacci run.

### Scenario 2: `200x200` matrix multiply `x 8`

| Mode | Median | Relative to sequential |
| --- | ---: | ---: |
| Sequential (main thread) | 151.2 ms | 1.00x |
| `puru spawn()` | 56.6 ms | 2.67x faster |
| `puru task()` | 32.2 ms | 4.70x faster |
| `piscina` | 39.1 ms | 3.87x faster |

Takeaway: In this medium CPU benchmark on Bun, `puru task()` had the best sampled median and outperformed `piscina` by about `1.21x`.

### Scenario 3: dispatch overhead, `1000` trivial tasks

| Mode | Median | Throughput |
| --- | ---: | ---: |
| Sequential (main thread) | 0.0 ms | 36,979,513 tasks/sec |
| `puru spawn()` | 12.3 ms | 81,227 tasks/sec |
| `puru task()` | 12.6 ms | 79,171 tasks/sec |
| `piscina` | 10.3 ms | 96,635 tasks/sec |

Takeaway: For trivial cross-thread work on Bun, `piscina` also led the sampled median.

## Summary

`puru` exposes two worker execution styles:

- `spawn()` for one-off inline jobs with zero worker-file setup
- `task()` for repeated CPU-bound work where the function is registered once and invoked many times

In repeated CPU-bound benchmarks, `task()` is the fairest comparison against `piscina`. In the measurements above:

- on Node.js, `puru task()` was within a few percent of `piscina` on heavy Fibonacci work and faster on the matrix benchmark
- on Bun, `puru task()` was also close on Fibonacci and faster on the matrix benchmark
- for trivial tasks, `piscina` had lower dispatch overhead in both runtimes

Practical positioning:

- use `spawn()` when convenience and inline worker code matter most
- use `task()` when benchmarking `puru` for production-style repeated CPU work
- compare trivial-task results carefully, because scheduler overhead dominates there

## What This Does Not Prove

These numbers are useful, but they should not be framed as universal wins.

They do not fully measure:

- long-running memory behavior
- p95 and p99 latency under queue contention
- worker crash recovery
- cancellation-heavy workloads
- shutdown behavior under load
- framework integration overhead
