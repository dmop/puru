import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  background,
  withCancel,
  withTimeout,
  withDeadline,
  withValue,
  CancelledError,
  DeadlineExceededError,
} from '../src/context.js'

describe('Context', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // ---------------------------------------------------------------------------
  // background
  // ---------------------------------------------------------------------------

  describe('background', () => {
    it('is never cancelled', () => {
      const ctx = background()
      expect(ctx.signal.aborted).toBe(false)
      expect(ctx.err).toBeNull()
      expect(ctx.deadline).toBeNull()
    })

    it('returns the same instance', () => {
      expect(background()).toBe(background())
    })

    it('value returns undefined for any key', () => {
      expect(background().value('anything')).toBeUndefined()
      expect(background().value(Symbol('x'))).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // withCancel
  // ---------------------------------------------------------------------------

  describe('withCancel', () => {
    it('starts active', () => {
      const [ctx] = withCancel(background())
      expect(ctx.signal.aborted).toBe(false)
      expect(ctx.err).toBeNull()
    })

    it('cancels the child context', () => {
      const [ctx, cancel] = withCancel(background())
      cancel()
      expect(ctx.signal.aborted).toBe(true)
      expect(ctx.err).toBeInstanceOf(CancelledError)
      expect(ctx.err!.message).toBe('context cancelled')
    })

    it('accepts a custom reason', () => {
      const [ctx, cancel] = withCancel(background())
      cancel('shutting down')
      expect(ctx.err!.message).toBe('shutting down')
    })

    it('cancel is idempotent', () => {
      const [ctx, cancel] = withCancel(background())
      cancel('first')
      cancel('second')
      expect(ctx.err!.message).toBe('first')
    })

    it('done() resolves on cancel', async () => {
      const [ctx, cancel] = withCancel(background())
      const p = ctx.done()
      cancel()
      await expect(p).resolves.toBeUndefined()
    })

    it('done() resolves immediately if already cancelled', async () => {
      const [ctx, cancel] = withCancel(background())
      cancel()
      await expect(ctx.done()).resolves.toBeUndefined()
    })

    it('propagates parent cancellation to child', () => {
      const [parent, cancelParent] = withCancel(background())
      const [child] = withCancel(parent)

      cancelParent()
      expect(child.signal.aborted).toBe(true)
      expect(child.err).toBeInstanceOf(CancelledError)
    })

    it('cancelling child does not cancel parent', () => {
      const [parent] = withCancel(background())
      const [child, cancelChild] = withCancel(parent)

      cancelChild()
      expect(child.signal.aborted).toBe(true)
      expect(parent.signal.aborted).toBe(false)
    })

    it('propagates through multiple levels', () => {
      const [root, cancelRoot] = withCancel(background())
      const [mid] = withCancel(root)
      const [leaf] = withCancel(mid)

      cancelRoot()
      expect(mid.signal.aborted).toBe(true)
      expect(leaf.signal.aborted).toBe(true)
    })

    it('child created from already-cancelled parent is immediately cancelled', () => {
      const [parent, cancel] = withCancel(background())
      cancel()
      const [child] = withCancel(parent)
      expect(child.signal.aborted).toBe(true)
      expect(child.err).toBeInstanceOf(CancelledError)
    })
  })

  // ---------------------------------------------------------------------------
  // withTimeout
  // ---------------------------------------------------------------------------

  describe('withTimeout', () => {
    it('cancels after the given duration', async () => {
      vi.useFakeTimers()
      const [ctx] = withTimeout(background(), 100)
      expect(ctx.signal.aborted).toBe(false)

      vi.advanceTimersByTime(100)
      expect(ctx.signal.aborted).toBe(true)
      expect(ctx.err).toBeInstanceOf(DeadlineExceededError)
      expect(ctx.err!.message).toBe('context deadline exceeded')
    })

    it('sets the deadline', () => {
      const before = Date.now()
      const [ctx] = withTimeout(background(), 5000)
      const after = Date.now()

      expect(ctx.deadline).toBeInstanceOf(Date)
      expect(ctx.deadline!.getTime()).toBeGreaterThanOrEqual(before + 5000)
      expect(ctx.deadline!.getTime()).toBeLessThanOrEqual(after + 5000)
    })

    it('can be cancelled early', () => {
      vi.useFakeTimers()
      const [ctx, cancel] = withTimeout(background(), 5000)
      cancel()
      expect(ctx.signal.aborted).toBe(true)
      expect(ctx.err).toBeInstanceOf(CancelledError)
    })

    it('parent cancellation beats timeout', () => {
      vi.useFakeTimers()
      const [parent, cancelParent] = withCancel(background())
      const [child] = withTimeout(parent, 5000)

      cancelParent()
      expect(child.signal.aborted).toBe(true)
      expect(child.err).toBeInstanceOf(CancelledError)
    })

    it('zero timeout cancels immediately', () => {
      const [ctx] = withTimeout(background(), 0)
      expect(ctx.signal.aborted).toBe(true)
      expect(ctx.err).toBeInstanceOf(DeadlineExceededError)
    })
  })

  // ---------------------------------------------------------------------------
  // withDeadline
  // ---------------------------------------------------------------------------

  describe('withDeadline', () => {
    it('cancels at the deadline', async () => {
      vi.useFakeTimers()
      const deadline = new Date(Date.now() + 200)
      const [ctx] = withDeadline(background(), deadline)

      expect(ctx.signal.aborted).toBe(false)
      vi.advanceTimersByTime(200)
      expect(ctx.signal.aborted).toBe(true)
      expect(ctx.err).toBeInstanceOf(DeadlineExceededError)
    })

    it('inherits earlier parent deadline', () => {
      const earlyDeadline = new Date(Date.now() + 1000)
      const lateDeadline = new Date(Date.now() + 5000)

      const [parent] = withDeadline(background(), earlyDeadline)
      const [child] = withDeadline(parent, lateDeadline)

      // Child should inherit the earlier parent deadline
      expect(child.deadline!.getTime()).toBe(earlyDeadline.getTime())
    })

    it('uses own deadline if earlier than parent', () => {
      const parentDeadline = new Date(Date.now() + 5000)
      const childDeadline = new Date(Date.now() + 1000)

      const [parent] = withDeadline(background(), parentDeadline)
      const [child] = withDeadline(parent, childDeadline)

      expect(child.deadline!.getTime()).toBe(childDeadline.getTime())
    })

    it('past deadline cancels immediately', () => {
      const past = new Date(Date.now() - 1000)
      const [ctx] = withDeadline(background(), past)
      expect(ctx.signal.aborted).toBe(true)
      expect(ctx.err).toBeInstanceOf(DeadlineExceededError)
    })
  })

  // ---------------------------------------------------------------------------
  // withValue
  // ---------------------------------------------------------------------------

  describe('withValue', () => {
    it('stores and retrieves a value by string key', () => {
      const ctx = withValue(background(), 'userId', 42)
      expect(ctx.value('userId')).toBe(42)
    })

    it('stores and retrieves a value by symbol key', () => {
      const key = Symbol('token')
      const ctx = withValue(background(), key, 'abc-123')
      expect(ctx.value(key)).toBe('abc-123')
    })

    it('returns undefined for missing keys', () => {
      const ctx = withValue(background(), 'a', 1)
      expect(ctx.value('b')).toBeUndefined()
    })

    it('chains values through ancestors', () => {
      const ctx1 = withValue(background(), 'a', 1)
      const ctx2 = withValue(ctx1, 'b', 2)
      const ctx3 = withValue(ctx2, 'c', 3)

      expect(ctx3.value('a')).toBe(1)
      expect(ctx3.value('b')).toBe(2)
      expect(ctx3.value('c')).toBe(3)
    })

    it('child value shadows parent value for the same key', () => {
      const ctx1 = withValue(background(), 'x', 'original')
      const ctx2 = withValue(ctx1, 'x', 'override')

      expect(ctx2.value('x')).toBe('override')
      expect(ctx1.value('x')).toBe('original')
    })

    it('inherits cancellation from parent', () => {
      const [parent, cancel] = withCancel(background())
      const ctx = withValue(parent, 'key', 'val')
      cancel()
      expect(ctx.signal.aborted).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Composition
  // ---------------------------------------------------------------------------

  describe('composition', () => {
    it('withValue + withTimeout + withCancel compose', () => {
      vi.useFakeTimers()
      const [cancelCtx, cancel] = withCancel(background())
      const [timeoutCtx] = withTimeout(cancelCtx, 1000)
      const valueCtx = withValue(timeoutCtx, 'traceId', 'trace-xyz')

      expect(valueCtx.value('traceId')).toBe('trace-xyz')
      expect(valueCtx.deadline).toBeInstanceOf(Date)
      expect(valueCtx.signal.aborted).toBe(false)

      cancel()
      expect(valueCtx.signal.aborted).toBe(true)
    })

    it('done() on a value context resolves when ancestor cancels', async () => {
      const [parent, cancel] = withCancel(background())
      const ctx = withValue(parent, 'k', 'v')
      const p = ctx.done()
      cancel()
      await expect(p).resolves.toBeUndefined()
    })

    it('sibling contexts are independent', () => {
      const [parent] = withCancel(background())
      const [a, cancelA] = withCancel(parent)
      const [b] = withCancel(parent)

      cancelA()
      expect(a.signal.aborted).toBe(true)
      expect(b.signal.aborted).toBe(false)
    })
  })
})
