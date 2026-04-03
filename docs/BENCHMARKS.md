# Benchmarks

Benchmarks were measured on an **Apple M1 Pro (8 cores), 16 GB RAM**.

Run them locally with:

```bash
npm run bench
npm run bench:bun
```

## CPU-Bound Parallelism

| Benchmark | Without puru | With puru | Speedup |
| --- | --: | --: | --: |
| Fibonacci (`fib(38) x8`) | 4,345 ms | 2,131 ms | **2.0x** |
| Prime counting (2M range) | 335 ms | 77 ms | **4.4x** |
| Matrix multiply (`200x200 x8`) | 140 ms | 39 ms | **3.6x** |
| Data processing (`100K items x8`) | 221 ms | 67 ms | **3.3x** |

### Bun

| Benchmark | Without puru | With puru | Speedup |
| --- | --: | --: | --: |
| Fibonacci (`fib(38) x8`) | 2,208 ms | 380 ms | **5.8x** |
| Prime counting (2M range) | 201 ms | 50 ms | **4.0x** |
| Matrix multiply (`200x200 x8`) | 197 ms | 57 ms | **3.5x** |
| Data processing (`100K items x8`) | 214 ms | 109 ms | **2.0x** |

## Channels Fan-Out Pipeline

200 items with CPU-heavy transform and 4 parallel transform workers:

| Approach | Time | vs Sequential |
| --- | --: | --: |
| Sequential (no channels) | 176 ms | baseline |
| Main-thread channels only | 174 ms | 1.0x |
| **puru fan-out (4 workers)** | **51 ms** | **3.4x faster** |

### Bun

| Approach | Time | vs Sequential |
| --- | --: | --: |
| Sequential (no channels) | 59 ms | baseline |
| Main-thread channels only | 60 ms | 1.0x |
| **puru fan-out (4 workers)** | **22 ms** | **2.7x faster** |

## Concurrent Async

100 async tasks with simulated I/O + CPU, running off the main thread:

| Approach | Time | vs Sequential |
| --- | --: | --: |
| Sequential | 1,140 ms | baseline |
| **puru concurrent** | **16 ms** | **73x faster** |

### Bun

| Approach | Time | vs Sequential |
| --- | --: | --: |
| Sequential | 1,110 ms | baseline |
| **puru concurrent** | **13 ms** | **87x faster** |

## Rule Of Thumb

- Spawn overhead is roughly `0.1-0.5ms`
- Use worker threads for work above roughly `5ms`
- Use `concurrent: true` when tasks mostly `await`
- Use default mode when the bottleneck is CPU
