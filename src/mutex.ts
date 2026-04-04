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
  private queue: (() => void)[] = [];
  private locked = false;

  async lock(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  unlock(): void {
    if (!this.locked) {
      throw new Error("Cannot unlock a mutex that is not locked");
    }
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }

  async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.lock();
    try {
      return await fn();
    } finally {
      this.unlock();
    }
  }

  get isLocked(): boolean {
    return this.locked;
  }
}

/**
 * Async read-write mutex. Multiple readers can hold the lock simultaneously,
 * but writers get exclusive access. Modeled after Go's `sync.RWMutex`.
 *
 * Use this instead of `Mutex` when reads vastly outnumber writes — concurrent
 * readers improve throughput without sacrificing write safety.
 *
 * Like `Mutex`, this operates on the main thread only. For cross-thread
 * coordination, use channels instead.
 *
 * @example
 * const rw = new RWMutex()
 *
 * // Multiple readers can run concurrently
 * const data = await rw.withRLock(async () => {
 *   return await db.get('config')
 * })
 *
 * // Writers get exclusive access
 * await rw.withLock(async () => {
 *   await db.set('config', newValue)
 * })
 */
export class RWMutex {
  private readers = 0;
  private writing = false;
  private readQueue: (() => void)[] = [];
  private writeQueue: (() => void)[] = [];

  async rLock(): Promise<void> {
    if (!this.writing && this.writeQueue.length === 0) {
      this.readers++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.readQueue.push(() => {
        this.readers++;
        resolve();
      });
    });
  }

  rUnlock(): void {
    if (this.readers <= 0) {
      throw new Error("Cannot rUnlock a RWMutex that is not read-locked");
    }
    this.readers--;
    if (this.readers === 0) {
      this.wakeWriter();
    }
  }

  async lock(): Promise<void> {
    if (!this.writing && this.readers === 0) {
      this.writing = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.writeQueue.push(() => {
        this.writing = true;
        resolve();
      });
    });
  }

  unlock(): void {
    if (!this.writing) {
      throw new Error("Cannot unlock a RWMutex that is not write-locked");
    }
    this.writing = false;
    // Prefer waking readers first (many can run); fall back to a writer
    if (this.readQueue.length > 0) {
      this.wakeReaders();
    } else {
      this.wakeWriter();
    }
  }

  async withRLock<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.rLock();
    try {
      return await fn();
    } finally {
      this.rUnlock();
    }
  }

  async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.lock();
    try {
      return await fn();
    } finally {
      this.unlock();
    }
  }

  get isLocked(): boolean {
    return this.writing || this.readers > 0;
  }

  private wakeReaders(): void {
    const queue = this.readQueue;
    this.readQueue = [];
    for (const wake of queue) {
      wake();
    }
  }

  private wakeWriter(): void {
    const next = this.writeQueue.shift();
    if (next) next();
  }
}
