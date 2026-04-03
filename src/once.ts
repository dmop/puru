export class Once<T = void> {
  private promise: Promise<T> | null = null
  private called = false

  async do(fn: () => T | Promise<T>): Promise<T> {
    if (!this.called) {
      this.called = true
      this.promise = Promise.resolve(fn())
    }
    return this.promise!
  }

  get done(): boolean {
    return this.called
  }

  reset(): void {
    this.called = false
    this.promise = null
  }
}
