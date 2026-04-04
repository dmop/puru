/**
 * Example: context — hierarchical cancellation, deadlines, and values
 *
 * Go's context package is the glue that makes cancellation and timeouts composable.
 * puru's context works the same way:
 *
 * background()                — root context, never cancelled
 * withCancel(parent)          — manual cancellation, propagates to children
 * withTimeout(parent, ms)     — auto-cancels after a duration
 * withDeadline(parent, date)  — auto-cancels at a specific time
 * withValue(parent, key, val) — attach request-scoped data
 *
 * When to use context:
 *   ✓ Enforcing request-level timeouts across multiple tasks
 *   ✓ Propagating cancellation through a tree of operations
 *   ✓ Carrying request-scoped values (trace IDs, user info) without threading args
 *   ✓ Composing deadlines — child gets the earlier of parent's or its own deadline
 */

import {
  background,
  withCancel,
  withTimeout,
  withDeadline,
  withValue,
  WaitGroup,
  ErrGroup,
  spawn,
  configure,
} from '../dist'

configure({ adapter: 'auto' })

// ─── withCancel: manual cancellation that propagates ─────────────────────────
//
// Cancel a parent context and all children cancel automatically.
// This is the foundation of structured cancellation.

{
  console.log('--- withCancel: parent/child propagation ---')

  const [parent, cancelParent] = withCancel(background())
  const [childA] = withCancel(parent)
  const [childB] = withCancel(parent)

  console.log(`  Before cancel — parent: ${!parent.signal.aborted}, childA: ${!childA.signal.aborted}, childB: ${!childB.signal.aborted}`)

  cancelParent()

  console.log(`  After cancel  — parent: ${!parent.signal.aborted}, childA: ${!childA.signal.aborted}, childB: ${!childB.signal.aborted}`)
  console.log(`  Error: ${parent.err?.message}`)
}

// ─── withTimeout + spawn ctx: auto-cancel tasks ─────────────────────────────
//
// Pass a context directly to spawn() — tasks auto-cancel when it expires.
// No manual wiring needed.

{
  console.log('\n--- withTimeout + spawn ctx: auto-cancel ---')

  const [ctx, cancel] = withTimeout(background(), 200)

  // Tasks auto-cancel when ctx expires — no done().then() needed
  const { result } = spawn(() => {
    let sum = 0
    for (let i = 0; i < 100_000; i++) sum += i
    return sum
  }, { ctx })

  try {
    console.log(`  Task result: ${await result}`)
  } catch {
    console.log('  Task cancelled by timeout')
  }

  console.log(`  Context expired: ${ctx.signal.aborted}`)
  console.log(`  Deadline was: ${ctx.deadline?.toISOString()}`)
  cancel()
}

// ─── withTimeout + WaitGroup: cancel all tasks ───────────────────────────────
//
// Pass context to WaitGroup constructor — all spawned tasks inherit it.

{
  console.log('\n--- withTimeout + WaitGroup(ctx): auto-cancel all ---')

  const [ctx, cancel] = withTimeout(background(), 200)

  // WaitGroup inherits context — all tasks auto-cancel
  const wg = new WaitGroup(ctx)

  wg.spawn(() => {
    let sum = 0
    for (let i = 0; i < 100_000; i++) sum += i
    return sum
  })

  wg.spawn(() => 42)

  try {
    const results = await wg.wait()
    console.log(`  Tasks completed: [${results.join(', ')}]`)
  } catch {
    console.log('  Tasks cancelled by timeout')
  }

  cancel()
}

// ─── ErrGroup with context + setLimit ────────────────────────────────────────
//
// Combine context with setLimit for controlled concurrent execution
// that auto-cancels on timeout or first error.

{
  console.log('\n--- ErrGroup(ctx) + setLimit ---')

  const [ctx, cancel] = withTimeout(background(), 500)
  const eg = new ErrGroup(ctx)
  eg.setLimit(2) // max 2 concurrent

  for (let i = 0; i < 4; i++) {
    eg.spawn(async () => {
      await new Promise<void>((r) => setTimeout(r, 30))
      return `task-${i}`
    })
  }

  try {
    const results = await eg.wait()
    console.log(`  Results: ${results.join(', ')}`)
  } catch {
    console.log('  Cancelled')
  }

  cancel()
}

// ─── withDeadline: absolute time boundary ────────────────────────────────────
//
// Like withTimeout, but with a specific Date instead of a duration.
// Useful when you have a fixed SLA or external deadline.

{
  console.log('\n--- withDeadline: absolute deadline ---')

  const deadline = new Date(Date.now() + 500) // 500ms from now
  const [ctx, cancel] = withDeadline(background(), deadline)

  console.log(`  Deadline set to: ${deadline.toISOString()}`)
  console.log(`  Active: ${!ctx.signal.aborted}`)

  // Wait for context to expire
  await ctx.done()
  console.log(`  Context expired with: ${ctx.err?.name}`)

  cancel() // cleanup
}

// ─── withValue: request-scoped data ──────────────────────────────────────────
//
// Attach metadata to a context. Values are looked up through the ancestor chain.
// Use for trace IDs, user info, or any data that should flow with the request.

{
  console.log('\n--- withValue: request-scoped metadata ---')

  // Simulate a request handler that attaches context
  const requestId = 'req-abc-123'
  const userId = 'user-42'

  const ctx = withValue(
    withValue(background(), 'requestId', requestId),
    'userId', userId,
  )

  // Any code with access to ctx can retrieve the values
  console.log(`  Request ID: ${ctx.value('requestId')}`)
  console.log(`  User ID: ${ctx.value('userId')}`)
  console.log(`  Missing key: ${ctx.value('nonexistent')}`)

  // Values can be shadowed by child contexts
  const adminCtx = withValue(ctx, 'userId', 'admin-override')
  console.log(`  Original userId: ${ctx.value('userId')}`)
  console.log(`  Admin userId: ${adminCtx.value('userId')}`)
  console.log(`  Admin still sees requestId: ${adminCtx.value('requestId')}`)
}

// ─── Nested deadlines: child inherits the shorter deadline ───────────────────
//
// When a parent has a 5s deadline and you create a child with 10s,
// the child gets the parent's 5s deadline. The shorter deadline always wins.

{
  console.log('\n--- nested deadlines: shorter wins ---')

  const [parent, cancelParent] = withTimeout(background(), 1000) // 1s
  const [child, cancelChild] = withTimeout(parent, 5000)          // would be 5s, but parent is shorter

  const parentDeadline = parent.deadline!.getTime() - Date.now()
  const childDeadline = child.deadline!.getTime() - Date.now()

  console.log(`  Parent deadline in ~${Math.round(parentDeadline)}ms`)
  console.log(`  Child deadline in ~${Math.round(childDeadline)}ms (inherited from parent)`)
  console.log(`  Child got parent's deadline: ${child.deadline!.getTime() === parent.deadline!.getTime()}`)

  cancelParent()
  cancelChild()
}

// ─── Full composition: values + timeout + cancel ─────────────────────────────
//
// Real-world pattern: a request context carries a trace ID, has a 2s SLA,
// and can be cancelled early by the caller.

{
  console.log('\n--- full composition: values + timeout + cancel ---')

  // 1. Start with background
  const root = background()

  // 2. Add request-scoped values
  const withTrace = withValue(root, 'traceId', 'trace-xyz-789')

  // 3. Add a 2s timeout for the entire request
  const [ctx, cancel] = withTimeout(withTrace, 2000)

  // Verify everything is accessible
  console.log(`  Trace ID: ${ctx.value('traceId')}`)
  console.log(`  Has deadline: ${ctx.deadline !== null}`)
  console.log(`  Active: ${!ctx.signal.aborted}`)

  // 4. Cancel early (simulating client disconnect)
  cancel('client disconnected')

  console.log(`  After cancel — active: ${!ctx.signal.aborted}`)
  console.log(`  Error: ${ctx.err?.message}`)
  console.log(`  Trace ID still available: ${ctx.value('traceId')}`)
}

// ─── done() as a coordination signal ─────────────────────────────────────────
//
// ctx.done() returns a promise that resolves when the context is cancelled.
// Use it to wire cancellation into any async workflow.

{
  console.log('\n--- done() for coordination ---')

  const [ctx, cancel] = withTimeout(background(), 150)

  // Simulate a long-running operation that respects cancellation
  const work = (async () => {
    const steps = ['fetch', 'parse', 'transform', 'save']
    for (const step of steps) {
      // Check if we should stop before each step
      if (ctx.signal.aborted) {
        return `stopped before ${step}`
      }
      // Simulate step taking ~50ms
      await new Promise<void>((r) => setTimeout(r, 50))
    }
    return 'all steps completed'
  })()

  const result = await work
  console.log(`  Result: ${result}`)
  console.log(`  Context expired: ${ctx.signal.aborted}`)

  cancel() // cleanup
}
