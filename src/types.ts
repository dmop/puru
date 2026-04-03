export interface PuruConfig {
  maxThreads: number
  strategy: 'fifo' | 'work-stealing'
  idleTimeout: number
  adapter: 'auto' | 'node' | 'bun' | 'inline'
  concurrency: number
}

export interface Task {
  id: string
  fnStr: string
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  priority: 'low' | 'normal' | 'high'
  concurrent: boolean
  channels?: Record<string, string>
}

export type WorkerMessage =
  | { type: 'execute'; taskId: string; fnStr: string; concurrent: boolean; channels?: Record<string, string> }
  | { type: 'cancel'; taskId: string }
  | { type: 'shutdown' }
  | { type: 'channel-result'; correlationId: number; value?: unknown; error?: string }

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; taskId: string; value: unknown }
  | { type: 'error'; taskId: string; message: string; stack?: string }
  | { type: 'channel-op'; channelId: string; op: 'send' | 'recv' | 'close'; correlationId: number; value?: unknown }

export interface SpawnResult<T> {
  result: Promise<T>
  cancel: () => void
}
