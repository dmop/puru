/**
 * Example: select, after, ticker, Timer
 *
 * These primitives let you coordinate async timing without callback spaghetti.
 *
 * after(ms)    — one-shot: resolves after a delay. Use with select() for timeouts. Fire-and-forget.
 * Timer(ms)    — one-shot: like after(), but can be stopped and reset. Use for debounce, cancellable timeouts.
 * ticker(ms)   — repeating: ticks every N ms. Use for polling, heartbeats, retries.
 * select(cases)— race multiple promises; call the handler of whichever resolves first.
 *                Supports both recv cases [ch.recv(), handler] and send cases [ch.send(v), handler].
 *
 * When to use select():
 *   ✓ Timeout a channel receive: [ch.recv(), timeout]
 *   ✓ Timeout a channel send: [ch.send(v), timeout]
 *   ✓ Race two channels — process whichever has data first
 *   ✓ Non-blocking channel check (with { default: ... })
 *
 * When to use after():
 *   ✓ Timeout a single async operation (wrap in select)
 *   ✓ Delay between retries
 *
 * When to use Timer instead of after():
 *   ✓ You need to cancel the timeout if work finishes early
 *   ✓ Debounce — reset on every input
 *   ✓ Retry with adjustable delay — reset between attempts
 *
 * When to use ticker():
 *   ✓ Health checks / polling on an interval
 *   ✓ Periodic stats reporting
 *   ✓ Heartbeat / keepalive
 */

import { chan, select, after, ticker, spawn, configure, Timer } from '../dist/index.js'

configure({ adapter: 'auto' })

// ─── select: timeout a channel receive ───────────────────────────────────────
//
// The classic Go pattern: wait for data OR a timeout, whichever comes first.

{
  console.log('--- select: timeout a channel receive ---')

  const ch = chan<string>(1)

  // Send a value after 200ms
  spawn(
    async ({ ch }) => {
      await new Promise<void>((r) => setTimeout(r, 200))
      await ch.send('hello from worker')
    },
    { channels: { ch }, concurrent: true },
  )

  // Race: receive OR 100ms timeout
  let received: string | null = null
  await select([
    [ch.recv(), (value) => { received = typeof value === 'string' || value === null ? value : String(value) }],
    [after(100), () => { received = 'timed out' }],
  ])

  console.log(`  Result: ${received}`)

  // Now wait for the value to arrive and race again with a longer timeout
  await select([
    [ch.recv(), (value) => { received = typeof value === 'string' || value === null ? value : String(value) }],
    [after(300), () => { received = 'timed out again' }],
  ])

  console.log(`  Result after longer wait: ${received}`)
}

// ─── select: race two channels ────────────────────────────────────────────────
//
// Multiple workers write to separate channels.
// Process whichever result arrives first.

{
  console.log('\n--- select: race two channels ---')

  const fast = chan<string>(1)
  const slow = chan<string>(1)

  spawn(
    async ({ fast }) => {
      await new Promise<void>((r) => setTimeout(r, 30))
      await fast.send('fast result')
    },
    { channels: { fast }, concurrent: true },
  )

  spawn(
    async ({ slow }) => {
      await new Promise<void>((r) => setTimeout(r, 150))
      await slow.send('slow result')
    },
    { channels: { slow }, concurrent: true },
  )

  let winner = ''
  await select([
    [fast.recv(), (v) => { winner = `fast channel: ${v}` }],
    [slow.recv(), (v) => { winner = `slow channel: ${v}` }],
    [after(200), () => { winner = 'timeout' }],
  ])

  console.log(`  Winner: ${winner}`)
}

// ─── select: non-blocking check (default) ────────────────────────────────────
//
// With { default: ... }, select returns immediately if no case is ready.
// Go's equivalent of a non-blocking channel operation.

{
  console.log('\n--- select: non-blocking channel check ---')

  const ch = chan<number>(1)
  let checked = 0
  let received = 0

  // Poll until we get a value or exceed 5 checks
  const sender = spawn(
    async ({ ch }) => {
      await new Promise<void>((r) => setTimeout(r, 80))
      await ch.send(42)
    },
    { channels: { ch }, concurrent: true },
  )

  while (checked < 10) {
    let gotValue = false
    await select(
      [[ch.recv(), (v) => { received = typeof v === 'number' ? v : 0; gotValue = true }]],
      { default: () => {} }, // non-blocking: returns immediately if nothing ready
    )

    if (gotValue) break
    checked++
    await new Promise<void>((r) => setTimeout(r, 20))
  }

  await sender.result
  console.log(`  Checked ${checked} time(s) before receiving: ${received}`)
}

// ─── ticker: periodic polling ─────────────────────────────────────────────────
//
// Tick every N ms. Ideal for health checks, stats, or any repeated work.
// Use stop() to cancel. The ticker is unref'd — it won't keep your process alive.

{
  console.log('\n--- ticker: periodic stats reporter ---')

  let tasksDone = 0
  const t = ticker(100) // every 100ms
  const start = Date.now()

  // Simulate work happening concurrently
  const worker = (async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((r) => setTimeout(r, 80))
      tasksDone++
    }
  })()

  // Report stats until work is done
  for await (const _ of t) {
    const elapsed = Date.now() - start
    console.log(`  [${elapsed}ms] tasks done: ${tasksDone}`)
    if (tasksDone >= 5) {
      t.stop()
      break
    }
    if (elapsed > 1000) {
      t.stop()
      break
    }
  }

  await worker
  console.log(`  Final: ${tasksDone} tasks completed`)
}

// ─── after: retry with delay ──────────────────────────────────────────────────
//
// after() is a simple one-shot timer. Use it to add delay between retries
// without blocking the process with setTimeout.

{
  console.log('\n--- after: retry with backoff ---')

  let attempts = 0

  async function unreliableOperation(): Promise<string> {
    attempts++
    if (attempts < 3) throw new Error(`attempt ${attempts} failed`)
    return `succeeded on attempt ${attempts}`
  }

  let result = ''
  const delays = [50, 100, 200] // exponential backoff

  for (const delay of delays) {
    try {
      result = await unreliableOperation()
      break
    } catch {
      await after(delay)
    }
  }

  console.log(`  ${result}`)
}

// ─── select: send case with timeout ──────────────────────────────────────────
//
// Try to send on a channel. If the buffer is full and no receiver is ready
// within the timeout, the send is skipped. Like Go's select with a send case.

{
  console.log('\n--- select: send with timeout ---')

  const ch = chan<number>(1)
  await ch.send(1) // fill the buffer

  let outcome = ''
  await select([
    [ch.send(2), () => { outcome = 'sent' }],
    [after(50), () => { outcome = 'send timed out (buffer full)' }],
  ])

  console.log(`  ${outcome}`)

  // Drain and try again — now it succeeds
  await ch.recv()
  await select([
    [ch.send(2), () => { outcome = 'sent successfully' }],
    [after(50), () => { outcome = 'send timed out' }],
  ])

  console.log(`  ${outcome}`)
}

// ─── Timer: cancellable timeout ──────────────────────────────────────────────
//
// Unlike after(), Timer can be stopped early — no dangling timer.

{
  console.log('\n--- Timer: cancellable timeout ---')

  const t = new Timer(500)

  // Work finishes in 50ms — stop the timer early
  const work = after(50).then(() => 'work done')

  let outcome = ''
  await select([
    [work, (v) => {
      const wasPending = t.stop()
      outcome = `${v} (timer cancelled: ${wasPending})`
    }],
    [t.channel, () => { outcome = 'timed out' }],
  ])

  console.log(`  ${outcome}`)
}

// ─── Timer: debounce ─────────────────────────────────────────────────────────
//
// Reset the timer on every event. It only fires after a period of silence.

{
  console.log('\n--- Timer: debounce pattern ---')

  const t = new Timer(100)
  let events = 0

  // Rapid events every 30ms — each resets the 100ms timer
  for (let i = 0; i < 5; i++) {
    events++
    t.reset(100)
    await after(30)
  }

  await t.channel
  console.log(`  Timer fired after ${events} events (debounced, only fires once)`)
}
