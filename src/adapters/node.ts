import { Worker } from 'node:worker_threads'
import { NODE_BOOTSTRAP_CODE } from '../bootstrap.js'
import type { ManagedWorker, WorkerAdapter } from './base.js'
import type { WorkerMessage, WorkerResponse } from '../types.js'

class NodeManagedWorker implements ManagedWorker {
  private worker: Worker

  constructor() {
    this.worker = new Worker(NODE_BOOTSTRAP_CODE, { eval: true })
  }

  get id(): number {
    return this.worker.threadId
  }

  postMessage(data: WorkerMessage): void {
    this.worker.postMessage(data)
  }

  terminate(): Promise<number> {
    return this.worker.terminate()
  }

  on(event: 'message', handler: (data: WorkerResponse) => void): void
  on(event: 'error', handler: (err: Error) => void): void
  on(event: 'exit', handler: (code: number) => void): void
  on(event: 'message' | 'error' | 'exit', handler: ((data: WorkerResponse) => void) | ((err: Error) => void) | ((code: number) => void)): void {
    this.worker.on(event, handler)
  }

  unref(): void {
    this.worker.unref()
  }

  ref(): void {
    this.worker.ref()
  }
}

export class NodeWorkerAdapter implements WorkerAdapter {
  createWorker(): ManagedWorker {
    return new NodeManagedWorker()
  }
}
