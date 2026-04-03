// Internal sentinel used to signal channel closure.
// Using a symbol instead of null means null is a valid value to send through a channel
// at the implementation level, and avoids silent failures if someone attempts to send null.
// The public recv() API still returns null for a closed channel — the symbol is not leaked.
const CLOSED = Symbol('puru.channel.closed')

/**
 * A Go-style channel for communicating between async tasks and across worker threads.
 *
 * Use `chan<T>(capacity?)` to create a channel. Values must be structured-cloneable
 * (no functions, symbols, or WeakRefs). `null` cannot be sent — `recv()` returns
 * `null` only when the channel is closed.
 *
 * @example
 * const ch = chan<number>(10)
 * await ch.send(42)
 * const value = await ch.recv() // 42
 * ch.close()
 * await ch.recv() // null — channel closed
 *
 * @example
 * // Async iteration ends automatically when the channel is closed
 * for await (const item of ch) {
 *   process(item)
 * }
 */
export interface Channel<T> {
  send(value: T): Promise<void>
  /** Resolves with the next value, or `null` if the channel is closed. */
  recv(): Promise<T | null>
  close(): void
  [Symbol.asyncIterator](): AsyncIterator<T>
}

interface PendingRecv<T> {
  resolve: (value: T | typeof CLOSED) => void
}

interface PendingSend<T> {
  value: T
  resolve: () => void
  reject: (reason: unknown) => void
}

let channelIdCounter = 0
const channelRegistry = new Map<string, ChannelImpl<NonNullable<unknown>>>()

class ChannelImpl<T extends NonNullable<unknown>> implements Channel<T> { // constraint: can't create channels of nullable type
  /** @internal */
  readonly _id: string
  private buffer: T[] = []
  private capacity: number
  private closed = false
  private recvQueue: PendingRecv<T>[] = []
  private sendQueue: PendingSend<T>[] = []

  constructor(capacity: number) {
    this._id = `__ch_${++channelIdCounter}`
    this.capacity = capacity
    channelRegistry.set(this._id, this as unknown as ChannelImpl<NonNullable<unknown>>)
  }

  send(value: T): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('send on closed channel'))
    }

    // If there's a waiting receiver, deliver directly
    const receiver = this.recvQueue.shift()
    if (receiver) {
      receiver.resolve(value)
      return Promise.resolve()
    }

    // If buffer has room, buffer it
    if (this.buffer.length < this.capacity) {
      this.buffer.push(value)
      return Promise.resolve()
    }

    // Block until a receiver is ready
    return new Promise<void>((resolve, reject) => {
      this.sendQueue.push({ value, resolve, reject })
    })
  }

  recv(): Promise<T | null> {
    // If buffer has a value, take it and unblock a pending sender
    if (this.buffer.length > 0) {
      const value = this.buffer.shift()!
      const sender = this.sendQueue.shift()
      if (sender) {
        this.buffer.push(sender.value)
        sender.resolve()
      }
      return Promise.resolve(value)
    }

    // If there's a pending sender (unbuffered or buffer was empty), take directly
    const sender = this.sendQueue.shift()
    if (sender) {
      sender.resolve()
      return Promise.resolve(sender.value)
    }

    // If closed, return null
    if (this.closed) {
      return Promise.resolve(null)
    }

    // Block until a sender provides a value or channel closes
    return new Promise<T | null>((resolve) => {
      this.recvQueue.push({
        resolve: (v) => resolve(v === CLOSED ? null : (v as T)),
      })
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true

    // Resolve all pending receivers with the CLOSED sentinel (converted to null at the public boundary)
    for (const receiver of this.recvQueue) {
      receiver.resolve(CLOSED)
    }
    this.recvQueue = []

    // Reject all pending senders
    for (const sender of this.sendQueue) {
      sender.reject(new Error('send on closed channel'))
    }
    this.sendQueue = []
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const value = await this.recv()
      if (value === null) return
      yield value
    }
  }
}

/**
 * Create a Go-style channel for communicating between tasks and across worker threads.
 *
 * Provides backpressure: `send()` blocks when the buffer is full,
 * `recv()` blocks when the buffer is empty. Channel values must be structured-cloneable
 * (no functions, symbols, or WeakRefs). `null` cannot be sent — it signals closure.
 *
 * @param capacity Buffer size. `0` (default) = unbuffered: each `send()` blocks until a `recv()` is ready.
 *
 * @example
 * const ch = chan<string>(5) // buffered channel, capacity 5
 * await ch.send('hello')
 * const msg = await ch.recv() // 'hello'
 * ch.close()
 *
 * @example
 * // Fan-out: multiple workers pulling from the same channel
 * const input = chan<Job>(50)
 * const output = chan<Result>(50)
 *
 * for (let i = 0; i < 4; i++) {
 *   spawn(async ({ input, output }) => {
 *     for await (const job of input) {
 *       await output.send(processJob(job))
 *     }
 *   }, { channels: { input, output } })
 * }
 */
export function chan<T extends NonNullable<unknown>>(capacity: number = 0): Channel<T> {
  if (capacity < 0 || !Number.isInteger(capacity)) {
    throw new RangeError('Channel capacity must be a non-negative integer')
  }
  return new ChannelImpl<T>(capacity)
}

/** @internal */
export function getChannelById(id: string): Channel<NonNullable<unknown>> | undefined {
  return channelRegistry.get(id)
}

/** @internal */
export function resetChannelRegistry(): void {
  channelRegistry.clear()
  channelIdCounter = 0
}
