/**
 * A repeating timer that ticks at a fixed interval.
 *
 * Implements `AsyncIterable<void>` — use `for await...of` to run work on each tick.
 * Call `stop()` to cancel the ticker and end the iteration.
 *
 * Create with the `ticker(ms)` factory function.
 *
 * @example
 * const t = ticker(1000) // tick every second
 * for await (const _ of t) {
 *   await doWork()
 *   if (shouldStop) t.stop() // ends the for-await loop
 * }
 *
 * @example
 * // Use with select() to process work on each tick with a timeout
 * const t = ticker(5000)
 * for await (const _ of t) {
 *   await select([
 *     [spawn(() => checkHealth()).result, (ok) => report(ok)],
 *     [after(4000), () => report('timeout')],
 *   ])
 * }
 */
export class Ticker {
  private interval: ReturnType<typeof setInterval> | null = null;
  private resolve: ((value: boolean) => void) | null = null;
  private stopped = false;
  private ms: number;

  constructor(ms: number) {
    this.ms = ms;
    this.interval = setInterval(() => {
      if (this.resolve) {
        const r = this.resolve;
        this.resolve = null;
        r(true);
      }
    }, ms);
    if (this.interval.unref) this.interval.unref();
  }

  async tick(): Promise<boolean> {
    if (this.stopped) return false;
    return new Promise<boolean>((resolve) => {
      this.resolve = resolve;
      // Re-check after assignment: stop() may have been called between
      // the guard above and here, in which case this.resolve was never
      // seen by stop() and the promise would hang.
      if (this.stopped) {
        this.resolve = null;
        resolve(false);
      }
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r(false); // resolve pending tick with false — the ticker has stopped
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<void> {
    while (await this.tick()) {
      yield;
    }
  }
}

/**
 * Create a `Ticker` that fires every `ms` milliseconds.
 *
 * @example
 * const t = ticker(500)
 * for await (const _ of t) {
 *   console.log('tick')
 *   if (done) t.stop()
 * }
 */
export function ticker(ms: number): Ticker {
  return new Ticker(ms);
}
