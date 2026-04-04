/**
 * Hierarchical cancellation, deadlines, and request-scoped values — modeled after Go's `context` package.
 *
 * Context is the glue that makes cancellation and timeouts composable. Derive child
 * contexts from a parent: when the parent is cancelled, all children cancel automatically.
 *
 * @example
 * // Timeout a group of tasks
 * const [ctx, cancel] = withTimeout(background(), 5000)
 * const wg = new WaitGroup()
 * wg.spawn(() => longRunningWork())
 * ctx.done().then(() => wg.cancel())
 *
 * @example
 * // Nested deadlines
 * const [parent, cancelParent] = withCancel(background())
 * const [child, _] = withTimeout(parent, 1000)
 * // child cancels after 1s OR when cancelParent() is called — whichever comes first
 *
 * @example
 * // Request-scoped values
 * const reqCtx = withValue(background(), 'requestId', 'abc-123')
 * reqCtx.value('requestId') // 'abc-123'
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Returned by `ctx.err` when the context was explicitly cancelled. */
export class CancelledError extends Error {
  constructor(message = 'context cancelled') {
    super(message)
    this.name = 'CancelledError'
  }
}

/** Returned by `ctx.err` when the context's deadline has passed. */
export class DeadlineExceededError extends Error {
  constructor() {
    super('context deadline exceeded')
    this.name = 'DeadlineExceededError'
  }
}

export type ContextError = CancelledError | DeadlineExceededError

// ---------------------------------------------------------------------------
// Context interface
// ---------------------------------------------------------------------------

export interface Context {
  /** AbortSignal that fires when this context is cancelled or its deadline expires. */
  readonly signal: AbortSignal
  /** The deadline for this context, or `null` if none was set. */
  readonly deadline: Date | null
  /** The cancellation error, or `null` if the context is still active. */
  readonly err: ContextError | null
  /** Retrieves a value stored in this context or any of its ancestors. */
  value<T = unknown>(key: symbol | string): T | undefined
  /** Returns a promise that resolves when the context is cancelled. */
  done(): Promise<void>
}

export type CancelFunc = (reason?: string) => void

// ---------------------------------------------------------------------------
// Internal base
// ---------------------------------------------------------------------------

class BaseContext implements Context {
  protected _err: ContextError | null = null
  protected controller: AbortController
  protected parent: Context | null

  constructor(parent: Context | null) {
    this.parent = parent
    this.controller = new AbortController()

    // Propagate parent cancellation
    if (parent) {
      if (parent.signal.aborted) {
        // Parent already cancelled — cancel immediately
        this._err = parent.err ?? new CancelledError()
        this.controller.abort()
      } else {
        parent.signal.addEventListener(
          'abort',
          () => {
            if (!this.controller.signal.aborted) {
              this._err = parent.err ?? new CancelledError()
              this.controller.abort()
            }
          },
          { once: true },
        )
      }
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  get deadline(): Date | null {
    return this.parent?.deadline ?? null
  }

  get err(): ContextError | null {
    return this._err
  }

  value<T = unknown>(_key: symbol | string): T | undefined {
    return this.parent?.value<T>(_key)
  }

  done(): Promise<void> {
    if (this.controller.signal.aborted) return Promise.resolve()
    return new Promise((resolve) => {
      this.controller.signal.addEventListener('abort', () => resolve(), { once: true })
    })
  }
}

// ---------------------------------------------------------------------------
// Background context (root, never cancelled)
// ---------------------------------------------------------------------------

class BackgroundContext implements Context {
  private _signal = new AbortController().signal

  get signal(): AbortSignal {
    return this._signal
  }

  get deadline(): Date | null {
    return null
  }

  get err(): ContextError | null {
    return null
  }

  value<T = unknown>(_key: symbol | string): T | undefined {
    return undefined
  }

  done(): Promise<void> {
    // Never resolves — background is never cancelled
    return new Promise(() => {})
  }
}

let bg: BackgroundContext | null = null

/**
 * Returns the root context. It is never cancelled, has no deadline, and carries no values.
 * All other contexts should derive from this.
 */
export function background(): Context {
  if (!bg) bg = new BackgroundContext()
  return bg
}

// ---------------------------------------------------------------------------
// withCancel
// ---------------------------------------------------------------------------

class CancelContext extends BaseContext {
  cancel(reason?: string): void {
    if (!this.controller.signal.aborted) {
      this._err = new CancelledError(reason ?? 'context cancelled')
      this.controller.abort()
    }
  }
}

/**
 * Returns a child context and a cancel function. Calling `cancel()` cancels the child
 * and all contexts derived from it. The child also cancels when the parent does.
 */
export function withCancel(parent: Context): [Context, CancelFunc] {
  const ctx = new CancelContext(parent)
  return [ctx, (reason?: string) => ctx.cancel(reason)]
}

// ---------------------------------------------------------------------------
// withDeadline / withTimeout
// ---------------------------------------------------------------------------

class DeadlineContext extends BaseContext {
  private _deadline: Date
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(parent: Context, deadline: Date) {
    super(parent)
    this._deadline = deadline

    // Inherit the earlier deadline if the parent has one
    if (parent.deadline && parent.deadline < deadline) {
      this._deadline = parent.deadline
    }

    if (this.controller.signal.aborted) {
      // Already cancelled by parent propagation
      return
    }

    const ms = this._deadline.getTime() - Date.now()
    if (ms <= 0) {
      // Deadline already passed
      this._err = new DeadlineExceededError()
      this.controller.abort()
    } else {
      this.timer = setTimeout(() => {
        if (!this.controller.signal.aborted) {
          this._err = new DeadlineExceededError()
          this.controller.abort()
        }
      }, ms)
      // Don't keep the process alive just for this timer
      if (typeof this.timer === 'object' && 'unref' in this.timer) {
        this.timer.unref()
      }
    }
  }

  override get deadline(): Date {
    return this._deadline
  }

  cancel(reason?: string): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.controller.signal.aborted) {
      this._err = new CancelledError(reason ?? 'context cancelled')
      this.controller.abort()
    }
  }
}

/**
 * Returns a child context that automatically cancels at the given `deadline`.
 * If the parent has an earlier deadline, that deadline is inherited.
 * The returned cancel function can cancel early and clears the timer.
 */
export function withDeadline(parent: Context, deadline: Date): [Context, CancelFunc] {
  const ctx = new DeadlineContext(parent, deadline)
  return [ctx, (reason?: string) => ctx.cancel(reason)]
}

/**
 * Returns a child context that automatically cancels after `ms` milliseconds.
 * Equivalent to `withDeadline(parent, new Date(Date.now() + ms))`.
 */
export function withTimeout(parent: Context, ms: number): [Context, CancelFunc] {
  return withDeadline(parent, new Date(Date.now() + ms))
}

// ---------------------------------------------------------------------------
// withValue
// ---------------------------------------------------------------------------

class ValueContext extends BaseContext {
  private key: symbol | string
  private val: unknown

  constructor(parent: Context, key: symbol | string, val: unknown) {
    super(parent)
    this.key = key
    this.val = val
  }

  override value<T = unknown>(key: symbol | string): T | undefined {
    if (key === this.key) return this.val as T
    return this.parent?.value<T>(key)
  }
}

/**
 * Returns a child context carrying a key-value pair.
 * Values are retrieved with `ctx.value(key)` and looked up through the ancestor chain.
 */
export function withValue<T = unknown>(parent: Context, key: symbol | string, value: T): Context {
  return new ValueContext(parent, key, value)
}
