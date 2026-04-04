/**
 * A one-shot timer that can be stopped and reset. Like Go's `time.Timer`.
 *
 * Unlike `after()` which is fire-and-forget, `Timer` gives you control:
 * - `stop()` cancels a pending timer
 * - `reset(ms)` reschedules without allocating a new object
 *
 * The `channel` property is a promise that resolves when the timer fires.
 * After `stop()`, the promise never resolves. After `reset()`, a new `channel`
 * promise is created.
 *
 * @example
 * // Basic timeout with ability to cancel
 * const t = new Timer(5000)
 * await select([
 *   [ch.recv(), (v) => { t.stop(); handle(v) }],
 *   [t.channel, () => console.log('timed out')],
 * ])
 *
 * @example
 * // Reset a timer (e.g., debounce pattern)
 * const t = new Timer(300)
 * onInput(() => t.reset(300))
 * await t.channel // fires 300ms after last input
 */
export class Timer {
  private timer: ReturnType<typeof setTimeout> | null = null
  private _stopped = false

  /** Promise that resolves when the timer fires. Replaced on `reset()`. */
  channel: Promise<void>

  constructor(ms: number) {
    this.channel = this.schedule(ms)
  }

  private schedule(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.timer = setTimeout(() => {
        this._stopped = true
        this.timer = null
        resolve()
      }, ms)
      if (typeof this.timer === 'object' && 'unref' in this.timer) {
        this.timer.unref()
      }
    })
  }

  /**
   * Stop the timer. Returns `true` if the timer was pending (stopped before firing),
   * `false` if it had already fired or was already stopped.
   *
   * After stopping, the current `channel` promise will never resolve.
   */
  stop(): boolean {
    if (this.timer === null) return false
    clearTimeout(this.timer)
    this.timer = null
    this._stopped = true
    return true
  }

  /**
   * Reset the timer to fire after `ms` milliseconds.
   * If the timer was pending, it is stopped first. Creates a new `channel` promise.
   */
  reset(ms: number): void {
    this.stop()
    this._stopped = false
    this.channel = this.schedule(ms)
  }

  /** Whether the timer has fired or been stopped. */
  get stopped(): boolean {
    return this._stopped
  }
}
