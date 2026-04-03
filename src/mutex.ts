/**
 * Async mutual exclusion. Serializes access to shared state under concurrency.
 *
 * Prefer `withLock()` over manual `lock()`/`unlock()` — it automatically releases
 * the lock even if the callback throws.
 *
 * Note: `Mutex` operates on the main thread (or whichever thread creates it).
 * Worker threads do not share memory, so this is not useful for cross-thread locking.
 * For cross-thread coordination, use channels instead.
 *
 * @example
 * const mu = new Mutex()
 *
 * // withLock — recommended (auto-unlocks on error)
 * const result = await mu.withLock(async () => {
 *   const current = await db.get('counter')
 *   await db.set('counter', current + 1)
 *   return current + 1
 * })
 *
 * @example
 * // Manual lock/unlock (use withLock instead when possible)
 * await mu.lock()
 * try {
 *   // critical section
 * } finally {
 *   mu.unlock()
 * }
 */
export class Mutex {
  private queue: (() => void)[] = []
  private locked = false

  async lock(): Promise<void> {
    if (!this.locked) {
      this.locked = true
      return
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
    })
  }

  unlock(): void {
    if (!this.locked) {
      throw new Error('Cannot unlock a mutex that is not locked')
    }
    const next = this.queue.shift()
    if (next) {
      next()
    } else {
      this.locked = false
    }
  }

  async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.lock()
    try {
      return await fn()
    } finally {
      this.unlock()
    }
  }

  get isLocked(): boolean {
    return this.locked
  }
}
