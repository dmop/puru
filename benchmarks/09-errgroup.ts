/**
 * Benchmark: ErrGroup vs WaitGroup
 *
 * Compares ErrGroup (cancel-on-first-error) against WaitGroup
 * when one task fails early. ErrGroup should cancel remaining
 * tasks and return faster.
 */

import { WaitGroup, ErrGroup, configure } from '../dist/index.js'
import { bench, report } from './utils.js'

async function main() {
  configure({ adapter: 'auto' })

  const TASKS = 8

  // --- WaitGroup: waits for everything even after failure ---
  const wgBench = await bench(`WaitGroup (${TASKS} tasks, 1 fails)`, async () => {
    const wg = new WaitGroup()
    for (let i = 0; i < TASKS; i++) {
      if (i === 0) {
        wg.spawn(() => {
          throw new Error('fail')
        })
      } else {
        wg.spawn(() => {
          let s = 0
          for (let j = 0; j < 5_000_000; j++) s += j
          return s
        })
      }
    }
    try {
      await wg.waitSettled()
    } catch {}
    return 'done'
  })

  // --- ErrGroup: cancels remaining tasks on first failure ---
  const egBench = await bench(`ErrGroup (${TASKS} tasks, 1 fails)`, async () => {
    const eg = new ErrGroup()
    for (let i = 0; i < TASKS; i++) {
      if (i === 0) {
        eg.spawn(() => {
          throw new Error('fail')
        })
      } else {
        eg.spawn(() => {
          let s = 0
          for (let j = 0; j < 5_000_000; j++) s += j
          return s
        })
      }
    }
    try {
      await eg.wait()
    } catch {}
    return 'done'
  })

  report('ErrGroup vs WaitGroup — early failure cancellation', [wgBench, egBench])
}

main().catch(console.error)
