type SelectCase<T = unknown> = [Promise<T>, (value: T) => void]

export interface SelectOptions {
  default?: () => void
}

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
    // Race a microtask against the promises to check if any is immediately ready
    return new Promise<void>((resolve, reject) => {
      let settled = false

      // Check all promises for immediate resolution
      for (const [promise, handler] of cases) {
        Promise.resolve(promise).then(
          (value) => {
            if (settled) return
            settled = true
            try {
              handler(value)
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
            handler(value)
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
