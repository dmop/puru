/**
 * Example: ErrGroup
 *
 * Use ErrGroup when ALL tasks must succeed — one failure should cancel the rest.
 * This is the Go errgroup pattern, adapted for JavaScript.
 *
 * WaitGroup.wait() vs ErrGroup.wait():
 *   WaitGroup.wait()  — throws first error, but OTHER tasks keep running to completion
 *   ErrGroup.wait()   — throws first error AND immediately cancels all remaining tasks
 *
 * When to use ErrGroup:
 *   ✓ Fetching from multiple required services (user + orders + inventory)
 *   ✓ Writing to multiple sinks that must all succeed (DB + cache + search index)
 *   ✓ Any "all-or-nothing" operation
 *
 * When to use WaitGroup instead:
 *   ✓ Tasks are independent — partial results are useful
 *   ✓ You want all results, including failures (use waitSettled())
 */

import { ErrGroup, WaitGroup, configure, background, withTimeout } from '../dist/index.js'

configure({ adapter: 'auto' })

type UserProfile = { id: number; name: string; email: string }
type UserOrders = Array<{ id: number; total: number }>
type UserSubscription = { plan: string; seatsUsed: number; seatsTotal: number }
type TaskOutcome = string

function getErrorMessage(err: Error | DOMException): string {
  return err.message
}

// ─── All-or-nothing data fetch ────────────────────────────────────────────────
//
// Fetch a user's full profile from three services.
// If any service fails, there's no point continuing — cancel the rest.

async function loadUserProfile(userId: number) {
  const eg = new ErrGroup<UserProfile | UserOrders | UserSubscription>()

  eg.spawn(async () => {
    await new Promise<void>((r) => setTimeout(r, 30))
    if (userId < 0) throw new Error('User not found')
    return { id: userId, name: 'Alice', email: 'alice@example.com' }
  })

  eg.spawn(async () => {
    await new Promise<void>((r) => setTimeout(r, 20))
    return [{ id: 1, total: 99.99 }, { id: 2, total: 49.99 }]
  })

  eg.spawn(async () => {
    await new Promise<void>((r) => setTimeout(r, 40))
    return { plan: 'pro', seatsUsed: 3, seatsTotal: 10 }
  })

  const [user, orders, subscription] = await eg.wait()
  return { user, orders, subscription }
}

{
  console.log('--- ErrGroup: load full user profile ---')

  try {
    const profile = await loadUserProfile(42)
    console.log('  Profile loaded:', JSON.stringify(profile, null, 2).replace(/\n/g, '\n  '))
  } catch (err) {
    if (err instanceof Error || err instanceof DOMException) {
      console.error('  Failed:', getErrorMessage(err))
    } else {
      throw err
    }
  }
}

{
  console.log('\n--- ErrGroup: one failure cancels the rest ---')

  try {
    const profile = await loadUserProfile(-1) // triggers error
    console.log('  (should not reach here)')
    void profile
  } catch (err) {
    if (err instanceof Error || err instanceof DOMException) {
      console.log('  Caught first error:', getErrorMessage(err))
      console.log('  All remaining tasks were cancelled')
    } else {
      throw err
    }
  }
}

// ─── ErrGroup vs WaitGroup: side-by-side ─────────────────────────────────────
//
// With WaitGroup, all tasks run to completion even if one fails.
// With ErrGroup, a failure cancels remaining tasks.

{
  console.log('\n--- Side-by-side: ErrGroup vs WaitGroup on partial failure ---')

  const makeTask = (id: number, failAt: number | null) =>
    async () => {
      await new Promise<void>((r) => setTimeout(r, id * 100))
      if (id === failAt) throw new Error(`task ${id} failed`)
      return `task ${id} ok`
    }

  // WaitGroup — all 3 tasks run regardless
  {
    const wg = new WaitGroup()
    wg.spawn(makeTask(1, null), { concurrent: true })
    wg.spawn(makeTask(2, 2), { concurrent: true }) // this one fails
    wg.spawn(makeTask(3, null), { concurrent: true })

    const settled = await wg.waitSettled()
    const outcomes = settled.map((r) =>
      r.status === 'fulfilled' ? r.value : `ERROR: ${(r as PromiseRejectedResult).reason.message}`,
    )
    console.log('  WaitGroup results:', outcomes)
  }

  // ErrGroup — tasks 1 and 3 are cancelled when task 2 fails
  {
    const eg = new ErrGroup<TaskOutcome>()
    eg.spawn(makeTask(1, null))
    eg.spawn(makeTask(2, 2)) // this one fails
    eg.spawn(makeTask(3, null))

    try {
      await eg.wait()
    } catch (err) {
      if (err instanceof Error || err instanceof DOMException) {
        console.log('  ErrGroup threw:', getErrorMessage(err), '(other tasks cancelled)')
      } else {
        throw err
      }
    }
  }
}

// ─── setLimit: throttle concurrent tasks ─────────────────────────────────────
//
// Like Go's errgroup.SetLimit(). Prevents spawning too many tasks at once.
// Queued tasks wait for a slot to open before starting.

{
  console.log('\n--- ErrGroup.setLimit: max 2 concurrent tasks ---')

  const eg = new ErrGroup<string>()
  eg.setLimit(2) // only 2 tasks run at a time

  for (let i = 1; i <= 6; i++) {
    eg.spawn(async () => {
      await new Promise<void>((r) => setTimeout(r, 50))
      return `task-${i} done`
    })
  }

  const results = await eg.wait()
  console.log(`  Completed ${results.length} tasks with limit=2: ${results.join(', ')}`)
}

// ─── ErrGroup with context ───────────────────────────────────────────────────
//
// Pass a context to auto-cancel all tasks when the context expires.

{
  console.log('\n--- ErrGroup with context: auto-cancel on timeout ---')

  const [ctx, cancel] = withTimeout(background(), 200)
  const eg = new ErrGroup(ctx)

  eg.spawn(async () => {
    await new Promise<void>((r) => setTimeout(r, 50))
    return 'fast task'
  })

  eg.spawn(async () => {
    await new Promise<void>((r) => setTimeout(r, 50))
    return 'another fast task'
  })

  try {
    const results = await eg.wait()
    console.log(`  Results: ${results.join(', ')}`)
  } catch (err) {
    if (err instanceof Error || err instanceof DOMException) {
      console.log('  Cancelled:', getErrorMessage(err))
    } else {
      throw err
    }
  } finally {
    cancel()
  }
}
