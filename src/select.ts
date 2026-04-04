import type { StructuredCloneValue } from './types.js'

type RecvCase<T = StructuredCloneValue> = [Promise<T>, (value: T) => void]
type SendCase = [Promise<void>, () => void]
type SelectCase<T = StructuredCloneValue> = RecvCase<T> | SendCase

/**
 * Options for `select()`.
 *
 * `default` makes the call non-blocking: if no case is immediately ready,
 * the default handler runs instead of waiting. This mirrors Go's `select { default: ... }`.
 */
export interface SelectOptions {
  default?: () => void
}

/**
 * Wait for the first of multiple promises to resolve, like Go's `select`.
 *
 * Each case is a `[promise, handler]` tuple. The handler for the first settled
 * promise is called with its value. All other handlers are ignored.
 *
 * **Recv cases:** `[ch.recv(), (value) => ...]` — handler receives the value.
 * **Send cases:** `[ch.send(value), () => ...]` — handler is called when the send completes.
 *
 * If `opts.default` is provided, `select` becomes non-blocking: if no promise
 * is already resolved, the default runs immediately (Go's `select { default: ... }`).
 *
 * Commonly used with `ch.recv()`, `ch.send()`, `after()`, and `spawn().result`.
 *
 * @example
 * // Block until a channel message arrives or timeout after 5s
 * await select([
 *   [ch.recv(), (value) => console.log('received', value)],
 *   [after(5000), () => console.log('timed out')],
 * ])
 *
 * @example
 * // Non-blocking: check a channel without waiting
 * await select(
 *   [[ch.recv(), (value) => process(value)]],
 *   { default: () => console.log('channel empty — doing other work') },
 * )
 *
 * @example
 * // Select with send case — try to send or timeout
 * await select([
 *   [ch.send(value), () => console.log('sent!')],
 *   [after(1000), () => console.log('send timed out')],
 * ])
 *
 * @example
 * // Race two worker results against a deadline
 * const { result: fast } = spawn(() => quickSearch(query))
 * const { result: deep } = spawn(() => deepSearch(query))
 *
 * let response: Result
 * await select([
 *   [fast, (r) => { response = r }],
 *   [after(200), () => { response = { partial: true } }],
 * ])
 */
export function select(
  cases: SelectCase[],
  opts?: SelectOptions,
): Promise<void> {
  if (cases.length === 0) {
    if (opts?.default) {
      opts.default()
    }
    return Promise.resolve()
  }

  // Non-blocking: if default is provided, check if any promise is already settled
  if (opts?.default) {
    return new Promise<void>((resolve, reject) => {
      let settled = false

      // Check all promises for immediate resolution
      for (const [promise, handler] of cases) {
        Promise.resolve(promise).then(
          (value) => {
            if (settled) return
            settled = true
            try {
              ;(handler as (value: unknown) => void)(value)
              resolve()
            } catch (err) {
              reject(err)
            }
          },
          (err) => {
            if (settled) return
            settled = true
            reject(err)
          },
        )
      }

      // Schedule default on the next microtask — if no promise resolved synchronously,
      // default wins
      queueMicrotask(() => {
        if (settled) return
        settled = true
        try {
          opts.default!()
          resolve()
        } catch (err) {
          reject(err)
        }
      })
    })
  }

  // Blocking: wait for the first promise to settle
  return new Promise<void>((resolve, reject) => {
    let settled = false

    cases.forEach(([promise, handler]) => {
      promise.then(
        (value) => {
          if (settled) return
          settled = true
          try {
            ;(handler as (value: unknown) => void)(value)
            resolve()
          } catch (err) {
            reject(err)
          }
        },
        (err) => {
          if (settled) return
          settled = true
          reject(err)
        },
      )
    })
  })
}
