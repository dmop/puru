/**
 * Weighted counting semaphore. Limits concurrent access to a resource where
 * each acquisition can have a different cost. Modeled after Go's
 * `golang.org/x/sync/semaphore.Weighted`.
 *
 * A `Mutex` is equivalent to `new Semaphore(1)` — one holder at a time.
 * A `Semaphore` generalizes this to N units, with variable-weight acquisitions.
 *
 * Like `Mutex`, this operates on the main thread only. For cross-thread
 * coordination, use channels instead.
 *
 * @example
 * // Limit to 10 concurrent DB connections
 * const sem = new Semaphore(10)
 *
 * await sem.acquire()     // take 1 slot
 * try {
 *   await db.query(...)
 * } finally {
 *   sem.release()
 * }
 *
 * @example
 * // Weighted: heavy queries cost more
 * const sem = new Semaphore(10)
 *
 * await sem.acquire(5)    // heavy query takes 5 slots
 * sem.release(5)
 *
 * @example
 * // withAcquire — recommended (auto-releases on error)
 * const result = await sem.withAcquire(async () => {
 *   return await fetch(url)
 * })
 *
 * @example
 * // Non-blocking check
 * if (sem.tryAcquire(3)) {
 *   try { ... } finally { sem.release(3) }
 * }
 */
export class Semaphore {
  private max: number;
  private cur: number;
  private queue: { n: number; resolve: () => void }[] = [];

  constructor(n: number) {
    if (n <= 0 || !Number.isInteger(n)) {
      throw new Error("Semaphore capacity must be a positive integer");
    }
    this.max = n;
    this.cur = 0;
  }

  /**
   * Acquire `n` permits, waiting if necessary until they are available.
   * Acquires are served in FIFO order.
   */
  async acquire(n = 1): Promise<void> {
    if (n <= 0 || !Number.isInteger(n)) {
      throw new Error("Acquire count must be a positive integer");
    }
    if (n > this.max) {
      throw new Error(`Acquire count ${n} exceeds semaphore capacity ${this.max}`);
    }
    if (this.cur + n <= this.max && this.queue.length === 0) {
      this.cur += n;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push({ n, resolve });
    });
  }

  /**
   * Try to acquire `n` permits without blocking.
   * Returns `true` if successful, `false` if not enough permits are available.
   */
  tryAcquire(n = 1): boolean {
    if (n <= 0 || !Number.isInteger(n)) {
      throw new Error("Acquire count must be a positive integer");
    }
    if (n > this.max) {
      throw new Error(`Acquire count ${n} exceeds semaphore capacity ${this.max}`);
    }
    if (this.cur + n <= this.max && this.queue.length === 0) {
      this.cur += n;
      return true;
    }
    return false;
  }

  /**
   * Release `n` permits, potentially waking queued acquirers.
   */
  release(n = 1): void {
    if (n <= 0 || !Number.isInteger(n)) {
      throw new Error("Release count must be a positive integer");
    }
    if (this.cur - n < 0) {
      throw new Error("Released more permits than acquired");
    }
    this.cur -= n;
    this.wake();
  }

  /**
   * Acquire `n` permits, run `fn`, then release automatically — even if `fn` throws.
   */
  async withAcquire<T>(fn: () => T | Promise<T>, n = 1): Promise<T> {
    await this.acquire(n);
    try {
      return await fn();
    } finally {
      this.release(n);
    }
  }

  /** Number of permits currently available. */
  get available(): number {
    return this.max - this.cur;
  }

  /** Total capacity of the semaphore. */
  get capacity(): number {
    return this.max;
  }

  private wake(): void {
    while (this.queue.length > 0) {
      const head = this.queue[0];
      if (this.cur + head.n > this.max) break;
      this.queue.shift();
      this.cur += head.n;
      head.resolve();
    }
  }
}
