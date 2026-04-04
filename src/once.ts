/**
 * Run a function exactly once, even if called concurrently.
 * All callers await the same promise and receive the same result.
 *
 * Use for lazy, one-time initialization of expensive resources (DB pools, ML models,
 * config, etc.) that must be initialized at most once regardless of concurrent demand.
 *
 * @example
 * const initDB = new Once<DBPool>()
 *
 * async function getDB() {
 *   return initDB.do(() => createPool({ max: 10 }))
 * }
 *
 * // Safe under concurrent load — pool is created exactly once
 * const [db1, db2] = await Promise.all([getDB(), getDB()])
 * // db1 === db2 (same pool instance)
 *
 * @example
 * // Check if initialization has already run
 * if (!initDB.done) {
 *   console.log('not yet initialized')
 * }
 */
export class Once<T = void> {
  private promise: Promise<T> | null = null;
  private called = false;

  async do(fn: () => T | Promise<T>): Promise<T> {
    if (!this.called) {
      this.called = true;
      this.promise = Promise.resolve(fn());
    }
    return this.promise!;
  }

  get done(): boolean {
    return this.called;
  }

  reset(): void {
    this.called = false;
    this.promise = null;
  }
}
