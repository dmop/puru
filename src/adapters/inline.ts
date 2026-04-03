import type { ManagedWorker, WorkerAdapter } from './base.js'
import { getChannelById } from '../channel.js'

let inlineIdCounter = 0

type MessageHandler = (data: unknown) => void
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

  postMessage(data: unknown): void {
    if (this.terminated) return

    const msg = data as { type: string; taskId?: string; fnStr?: string; concurrent?: boolean; channels?: Record<string, string>; correlationId?: number; value?: unknown; error?: string }
    if (msg.type === 'execute') {
      this.executeTask(msg.taskId!, msg.fnStr!, msg.concurrent ?? false, msg.channels)
    } else if (msg.type === 'cancel') {
      this.cancelledTasks.add(msg.taskId!)
    } else if (msg.type === 'channel-result') {
      // Route channel results back to pending RPC callbacks
      this.emit('message', msg)
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

  on(event: 'message', handler: MessageHandler): void
  on(event: 'error', handler: ErrorHandler): void
  on(event: 'exit', handler: ExitHandler): void
  on(event: string, handler: (...args: any[]) => void): void {
    if (event === 'message') this.messageHandlers.push(handler as MessageHandler)
    else if (event === 'error') this.errorHandlers.push(handler as ErrorHandler)
    else if (event === 'exit') this.exitHandlers.push(handler as ExitHandler)
  }

  unref(): void {}
  ref(): void {}

  private emit(event: 'message', data: unknown): void
  private emit(event: 'error', err: Error): void
  private emit(event: 'exit', code: number): void
  private emit(event: string, value: unknown): void {
    if (event === 'message') {
      for (const h of this.messageHandlers) h(value)
    } else if (event === 'error') {
      for (const h of this.errorHandlers) h(value as Error)
    } else if (event === 'exit') {
      for (const h of this.exitHandlers) h(value as number)
    }
  }

  private buildChannelProxies(channels: Record<string, string>): Record<string, unknown> {
    const self = this
    const proxies: Record<string, unknown> = {}
    for (const [name, channelId] of Object.entries(channels)) {
      proxies[name] = {
        _id: channelId,
        async send(value: unknown) {
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
          const ch = getChannelById(channelId) as any
          if (!ch) throw new Error(`Channel ${channelId} not found`)
          return {
            async next() {
              const value = await ch.recv()
              if (value === null) return { done: true, value: undefined }
              return { done: false, value }
            }
          }
        }
      }
    }
    return proxies
  }

  private executeTask(taskId: string, fnStr: string, concurrent: boolean, channels?: Record<string, string>): void {
    // Run on next microtask to simulate async worker behavior
    queueMicrotask(async () => {
      if (this.terminated) return
      if (concurrent && this.cancelledTasks.has(taskId)) {
        this.cancelledTasks.delete(taskId)
        return
      }
      try {
        let result: unknown
        if (channels) {
          const proxies = this.buildChannelProxies(channels)
          const fn = new Function('__ch', 'return (' + fnStr + ')(__ch)') as (ch: unknown) => unknown
          result = await fn(proxies)
        } else {
          const fn = new Function('return (' + fnStr + ')()') as () => unknown
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
