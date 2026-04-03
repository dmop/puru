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

import { ErrGroup, WaitGroup, configure } from '../dist/index.js'

configure({ adapter: 'auto' })

// ─── All-or-nothing data fetch ────────────────────────────────────────────────
//
// Fetch a user's full profile from three services.
// If any service fails, there's no point continuing — cancel the rest.

async function loadUserProfile(userId: number) {
  const eg = new ErrGroup()

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
  } catch (err: any) {
    console.error('  Failed:', err.message)
  }
}

{
  console.log('\n--- ErrGroup: one failure cancels the rest ---')

  try {
    const profile = await loadUserProfile(-1) // triggers error
    console.log('  (should not reach here)')
    void profile
  } catch (err: any) {
    console.log('  Caught first error:', err.message)
    console.log('  All remaining tasks were cancelled')
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
    const eg = new ErrGroup()
    eg.spawn(makeTask(1, null) as () => unknown)
    eg.spawn(makeTask(2, 2) as () => unknown) // this one fails
    eg.spawn(makeTask(3, null) as () => unknown)

    try {
      await eg.wait()
    } catch (err: any) {
      console.log('  ErrGroup threw:', err.message, '(other tasks cancelled)')
    }
  }
}
