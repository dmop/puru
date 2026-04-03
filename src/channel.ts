export interface Channel<T> {
  send(value: T): Promise<void>
  recv(): Promise<T | null>
  close(): void
  [Symbol.asyncIterator](): AsyncIterator<T>
}

interface PendingRecv<T> {
  resolve: (value: T | null) => void
}

interface PendingSend<T> {
  value: T
  resolve: () => void
  reject: (reason: unknown) => void
}

let channelIdCounter = 0
const channelRegistry = new Map<string, ChannelImpl<unknown>>()

class ChannelImpl<T> implements Channel<T> {
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
    channelRegistry.set(this._id, this as ChannelImpl<unknown>)
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
      this.recvQueue.push({ resolve })
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true

    // Resolve all pending receivers with null
    for (const receiver of this.recvQueue) {
      receiver.resolve(null)
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

export function chan<T>(capacity: number = 0): Channel<T> {
  if (capacity < 0 || !Number.isInteger(capacity)) {
    throw new RangeError('Channel capacity must be a non-negative integer')
  }
  return new ChannelImpl<T>(capacity)
}

/** @internal */
export function getChannelById(id: string): Channel<unknown> | undefined {
  return channelRegistry.get(id)
}

/** @internal */
export function resetChannelRegistry(): void {
  channelRegistry.clear()
  channelIdCounter = 0
}
