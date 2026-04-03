import type { ManagedWorker, WorkerAdapter } from './base.js'
import { getChannelById } from '../channel.js'
import type { ChannelMap, ChannelValue, StructuredCloneValue, WorkerMessage, WorkerResponse } from '../types.js'

let inlineIdCounter = 0

interface ChannelProxy {
  _id: string
  send(value: ChannelValue): Promise<void>
  recv(): Promise<ChannelValue | null>
  close(): void
  [Symbol.asyncIterator](): AsyncIterator<ChannelValue>
}

type MessageHandler = (data: WorkerResponse) => void
type ErrorHandler = (err: Error) => void
type ExitHandler = (code: number) => void

class InlineManagedWorker implements ManagedWorker {
  readonly id: number
  private messageHandlers: MessageHandler[] = []
  private errorHandlers: ErrorHandler[] = []
  private exitHandlers: ExitHandler[] = []
  private terminated = false
  private cancelledTasks = new Set<string>()

  constructor() {
    this.id = ++inlineIdCounter
    // Emit ready on next microtask (matches real worker timing)
    queueMicrotask(() => {
      this.emit('message', { type: 'ready' })
    })
  }

  postMessage(msg: WorkerMessage): void {
    if (this.terminated) return

    if (msg.type === 'execute') {
      this.executeTask(msg.taskId, msg.fnStr, msg.concurrent, msg.channels)
    } else if (msg.type === 'cancel') {
      this.cancelledTasks.add(msg.taskId)
    } else if (msg.type === 'channel-result') {
      // The inline adapter calls channels directly, so there is no worker-side RPC to route.
      return
    } else if (msg.type === 'shutdown') {
      this.terminated = true
      this.emit('exit', 0)
    }
  }

  terminate(): Promise<number> {
    this.terminated = true
    this.emit('exit', 1)
    return Promise.resolve(1)
  }

  on(event: 'message', handler: (data: WorkerResponse) => void): void
  on(event: 'error', handler: ErrorHandler): void
  on(event: 'exit', handler: ExitHandler): void
  on(event: 'message' | 'error' | 'exit', handler: MessageHandler | ErrorHandler | ExitHandler): void {
    if (event === 'message') this.messageHandlers.push(handler as MessageHandler)
    else if (event === 'error') this.errorHandlers.push(handler as ErrorHandler)
    else if (event === 'exit') this.exitHandlers.push(handler as ExitHandler)
  }

  unref(): void {}
  ref(): void {}

  private emit(event: 'message', data: WorkerResponse): void
  private emit(event: 'error', err: Error): void
  private emit(event: 'exit', code: number): void
  private emit(event: 'message' | 'error' | 'exit', value: WorkerResponse | Error | number): void {
    if (event === 'message') {
      for (const h of this.messageHandlers) h(value as WorkerResponse)
    } else if (event === 'error') {
      for (const h of this.errorHandlers) h(value as Error)
    } else if (event === 'exit') {
      for (const h of this.exitHandlers) h(value as number)
    }
  }

  private buildChannelProxies(channels: ChannelMap): Record<string, ChannelProxy> {
    const proxies: Record<string, ChannelProxy> = {}
    for (const [name, channelId] of Object.entries(channels)) {
      proxies[name] = {
        _id: channelId,
        async send(value: ChannelValue) {
          const ch = getChannelById(channelId)
          if (!ch) throw new Error(`Channel ${channelId} not found`)
          await ch.send(value)
        },
        async recv() {
          const ch = getChannelById(channelId)
          if (!ch) throw new Error(`Channel ${channelId} not found`)
          return ch.recv()
        },
        close() {
          const ch = getChannelById(channelId)
          if (ch) ch.close()
        },
        [Symbol.asyncIterator]() {
          const ch = getChannelById(channelId)
          if (!ch) throw new Error(`Channel ${channelId} not found`)
          return ch[Symbol.asyncIterator]()
        }
      }
    }
    return proxies
  }

  private executeTask(taskId: string, fnStr: string, concurrent: boolean, channels?: ChannelMap): void {
    // Run on next microtask to simulate async worker behavior
    queueMicrotask(async () => {
      if (this.terminated) return
      if (concurrent && this.cancelledTasks.has(taskId)) {
        this.cancelledTasks.delete(taskId)
        return
      }
      try {
        let result: StructuredCloneValue
        if (channels) {
          const proxies = this.buildChannelProxies(channels)
          const fn = new Function('__ch', 'return (' + fnStr + ')(__ch)') as (ch: Record<string, ChannelProxy>) => StructuredCloneValue | Promise<StructuredCloneValue>
          result = await fn(proxies)
        } else {
          const fn = new Function('return (' + fnStr + ')()') as () => StructuredCloneValue | Promise<StructuredCloneValue>
          result = await fn()
        }
        if (concurrent && this.cancelledTasks.has(taskId)) {
          this.cancelledTasks.delete(taskId)
          return
        }
        this.emit('message', { type: 'result', taskId, value: result })
      } catch (error) {
        if (concurrent && this.cancelledTasks.has(taskId)) {
          this.cancelledTasks.delete(taskId)
          return
        }
        this.emit('message', {
          type: 'error',
          taskId,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        })
      }
    })
  }
}

export class InlineAdapter implements WorkerAdapter {
  createWorker(): ManagedWorker {
    return new InlineManagedWorker()
  }
}
