/**
 * Example: Channels
 *
 * Channels let tasks communicate across worker threads without shared memory.
 * They work like Go channels — typed, async, with send/recv and backpressure.
 *
 * When to use channels:
 *   ✓ Pipeline/streaming: producer → transform workers → consumer
 *   ✓ Fan-out: one source, many workers pulling from the same channel
 *   ✓ Fan-in: many workers writing results to one output channel
 *   ✓ Backpressure: buffered channels let you control queue depth
 *
 * When NOT to use channels:
 *   ✗ Simple parallel tasks with no inter-task communication → use WaitGroup
 *   ✗ One-shot request/response → use spawn() directly
 *
 * Channel values must be structured-cloneable (no functions, symbols, WeakRefs).
 * null is reserved as the "closed" sentinel — don't send null.
 */

import { chan, spawn, configure } from '../dist/index.js'

configure({ adapter: 'auto' })

// ─── Basic: send and receive ──────────────────────────────────────────────────

{
  console.log('--- Basic: send and receive ---')

  const ch = chan<number>(5) // buffered, capacity 5

  // Producer: sends 5 values then closes
  spawn(
    async ({ ch }) => {
      for (let i = 1; i <= 5; i++) await ch.send(i)
      ch.close()
    },
    { channels: { ch }, concurrent: true },
  )

  // Consumer: reads until channel is closed
  for await (const value of ch) {
    process.stdout.write(`  received ${value} `)
  }
  console.log()
}

// ─── Fan-out pipeline ─────────────────────────────────────────────────────────
//
// One producer sends jobs into an input channel.
// Multiple workers pull from the same channel (fan-out).
// Results are collected in an output channel.
// One consumer drains the output channel.
//
//  producer ─→ [ input chan ] ─→ worker 1 ─┐
//                                worker 2 ─┤─→ [ output chan ] ─→ consumer
//                                worker 3 ─┘

{
  console.log('\n--- Fan-out pipeline: parallel transform ---')

  const NUM_JOBS = 20
  const NUM_WORKERS = 4

  const input = chan<number>(NUM_JOBS)
  const output = chan<{ n: number; result: number }>(NUM_JOBS)

  // Producer: push all jobs
  spawn(
    async ({ input }) => {
      for (let i = 1; i <= NUM_JOBS; i++) await input.send(i)
      input.close()
    },
    { channels: { input }, concurrent: true },
  )

  // Workers: each pulls jobs until input is exhausted
  let workersRunning = NUM_WORKERS
  for (let w = 0; w < NUM_WORKERS; w++) {
    spawn(
      async ({ input, output }) => {
        for await (const n of input) {
          // CPU-intensive transform — runs in parallel across workers
          let sum = 0
          for (let i = 1; i <= n * 10_000; i++) sum += i
          await output.send({ n, result: sum })
        }
      },
      { channels: { input, output } },
    ).result.finally(() => {
      workersRunning--
      if (workersRunning === 0) output.close()
    })
  }

  // Consumer: drain results as they arrive (streaming, not waiting for all)
  const results: number[] = []
  for await (const { n, result } of output) {
    results.push(n)
    void result
  }

  console.log(`  Processed ${results.length} jobs across ${NUM_WORKERS} workers`)
  console.log(`  Completed job IDs: ${results.sort((a, b) => a - b).join(', ')}`)
}

// ─── Backpressure ─────────────────────────────────────────────────────────────
//
// Buffered channels provide natural backpressure.
// send() blocks when the buffer is full — the producer slows down automatically.

{
  console.log('\n--- Backpressure: bounded buffer ---')

  const BUFFER_SIZE = 3
  const ch = chan<string>(BUFFER_SIZE)

  // Fast producer
  spawn(
    async ({ ch }) => {
      for (let i = 1; i <= 10; i++) {
        await ch.send(`item-${i}`)
        // send() blocks here when buffer is full, providing backpressure
      }
      ch.close()
    },
    { channels: { ch }, concurrent: true },
  )

  // Slow consumer
  const received: string[] = []
  for await (const item of ch) {
    await new Promise<void>((r) => setTimeout(r, 10)) // simulate slow processing
    received.push(item)
  }

  console.log(`  Received ${received.length} items with buffer size ${BUFFER_SIZE}`)
}

// ─── Fan-in: merge multiple sources ───────────────────────────────────────────
//
// Multiple workers write to the same output channel.
// The consumer gets results from all sources in arrival order.

{
  console.log('\n--- Fan-in: merge multiple worker outputs ---')

  const results = chan<{ worker: number; value: number }>(10)
  let pending = 3

  for (let w = 1; w <= 3; w++) {
    spawn(
      async ({ results }) => {
        const delay = w * 20
        await new Promise<void>((r) => setTimeout(r, delay))
        await results.send({ worker: w, value: w * 100 })
      },
      { channels: { results }, concurrent: true },
    ).result.finally(() => {
      pending--
      if (pending === 0) results.close()
    })
  }

  for await (const { worker, value } of results) {
    console.log(`  Worker ${worker} sent: ${value}`)
  }
}

// ─── Channel inspection: len and cap ─────────────────────────────────────────
//
// Like Go's len(ch) and cap(ch). Useful for monitoring backpressure.

{
  console.log('\n--- Channel inspection: len and cap ---')

  const ch = chan<number>(5)

  console.log(`  Empty: len=${ch.len}, cap=${ch.cap}`)

  await ch.send(1)
  await ch.send(2)
  await ch.send(3)
  console.log(`  After 3 sends: len=${ch.len}, cap=${ch.cap}`)

  await ch.recv()
  console.log(`  After 1 recv: len=${ch.len}, cap=${ch.cap}`)

  ch.close()
}

// ─── Directional channels: type-safe boundaries ─────────────────────────────
//
// sendOnly() and recvOnly() return views that restrict what callers can do.
// Like Go's chan<- T and <-chan T. Enforced at the type level.

{
  console.log('\n--- Directional channels ---')

  const ch = chan<string>(3)

  // Producer only gets send + close
  const producer = ch.sendOnly()
  await producer.send('hello')
  await producer.send('world')
  producer.close()

  // Consumer only gets recv + iteration
  const consumer = ch.recvOnly()
  const values: string[] = []
  for await (const v of consumer) {
    values.push(v)
  }

  console.log(`  Received via recvOnly: ${values.join(', ')}`)
}
