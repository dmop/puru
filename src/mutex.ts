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
