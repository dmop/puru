export class Ticker {
  private interval: ReturnType<typeof setInterval> | null = null
  private resolve: ((value: boolean) => void) | null = null
  private stopped = false
  private ms: number

  constructor(ms: number) {
    this.ms = ms
    this.interval = setInterval(() => {
      if (this.resolve) {
        const r = this.resolve
        this.resolve = null
        r(true)
      }
    }, ms)
    if (this.interval.unref) this.interval.unref()
  }

  async tick(): Promise<boolean> {
    if (this.stopped) return false
    return new Promise<boolean>((resolve) => {
      this.resolve = resolve
      // Re-check after assignment: stop() may have been called between
      // the guard above and here, in which case this.resolve was never
      // seen by stop() and the promise would hang.
      if (this.stopped) {
        this.resolve = null
        resolve(false)
      }
    })
  }

  stop(): void {
    this.stopped = true
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    if (this.resolve) {
      const r = this.resolve
      this.resolve = null
      r(false) // resolve pending tick with false — the ticker has stopped
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<void> {
    while (await this.tick()) {
      yield
    }
  }
}

export function ticker(ms: number): Ticker {
  return new Ticker(ms)
}
