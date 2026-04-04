import { Mutex } from "./mutex.js";

/**
 * Condition variable for async coordination. Modeled after Go's `sync.Cond`.
 *
 * A `Cond` is associated with a `Mutex`. Goroutines (async tasks) can:
 * - `wait()` — atomically release the lock and suspend until signaled, then re-acquire the lock
 * - `signal()` — wake one waiting task
 * - `broadcast()` — wake all waiting tasks
 *
 * Always check the condition in a loop — spurious wakeups are possible if
 * multiple waiters compete for the lock after `broadcast()`.
 *
 * @example
 * const mu = new Mutex()
 * const cond = new Cond(mu)
 * let ready = false
 *
 * // Waiter
 * await mu.lock()
 * while (!ready) {
 *   await cond.wait()
 * }
 * console.log('ready!')
 * mu.unlock()
 *
 * // Signaler (from another async context)
 * await mu.lock()
 * ready = true
 * cond.signal()
 * mu.unlock()
 *
 * @example
 * // Broadcast to wake all waiters
 * await mu.lock()
 * ready = true
 * cond.broadcast()
 * mu.unlock()
 */
export class Cond {
  private mu: Mutex;
  private waiters: (() => void)[] = [];

  constructor(mu: Mutex) {
    this.mu = mu;
  }

  /**
   * Atomically releases the mutex, suspends the caller until `signal()` or `broadcast()`
   * is called, then re-acquires the mutex before returning.
   *
   * Must be called while holding the mutex.
   */
  async wait(): Promise<void> {
    // Release the lock
    this.mu.unlock();

    // Wait for signal
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });

    // Re-acquire the lock
    await this.mu.lock();
  }

  /** Wake one waiting task (if any). */
  signal(): void {
    const next = this.waiters.shift();
    if (next) next();
  }

  /** Wake all waiting tasks. */
  broadcast(): void {
    const queue = this.waiters;
    this.waiters = [];
    for (const wake of queue) {
      wake();
    }
  }
}
