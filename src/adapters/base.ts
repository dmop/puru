import type { WorkerMessage, WorkerResponse } from '../types.js'

export interface ManagedWorker {
  readonly id: number
  postMessage(data: WorkerMessage): void
  terminate(): Promise<number>
  on(event: 'message', handler: (data: WorkerResponse) => void): void
  on(event: 'error', handler: (err: Error) => void): void
  on(event: 'exit', handler: (code: number) => void): void
  unref(): void
  ref(): void
}

export interface WorkerAdapter {
  createWorker(): ManagedWorker
}
