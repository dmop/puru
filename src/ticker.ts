export class Ticker {
  private interval: ReturnType<typeof setInterval> | null = null
  private resolve: (() => void) | null = null
  private stopped = false
  private ms: number

  constructor(ms: number) {
    this.ms = ms
    this.interval = setInterval(() => {
      if (this.resolve) {
        const r = this.resolve
        this.resolve = null
        r()
      }
    }, ms)
    if (this.interval.unref) this.interval.unref()
  }

  async tick(): Promise<boolean> {
    if (this.stopped) return false
    return new Promise<boolean>((resolve) => {
      this.resolve = () => resolve(true)
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
      r()
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
