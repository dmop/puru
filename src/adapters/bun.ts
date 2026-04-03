import { WEB_BOOTSTRAP_CODE } from '../bootstrap.js'
import type { ManagedWorker, WorkerAdapter } from './base.js'
import type { WorkerMessage, WorkerResponse } from '../types.js'
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

interface BunWorkerMessageEvent {
  data: WorkerResponse
}

interface BunWorkerErrorEvent {
  message: string
  error?: Error
}

interface BunWorkerCloseEvent {
  code?: number
}

interface BunRuntimeWorker {
  postMessage(data: WorkerMessage): void
  terminate(): void
  addEventListener(type: 'message', handler: (event: BunWorkerMessageEvent) => void): void
  addEventListener(type: 'error', handler: (event: BunWorkerErrorEvent) => void): void
  addEventListener(type: 'close', handler: (event: BunWorkerCloseEvent) => void): void
  unref?(): void
  ref?(): void
}

type BunWorkerConstructor = new (url: string | URL) => BunRuntimeWorker

let workerIdCounter = 0
let bootstrapFile: string | null = null

/**
 * Returns the path to a temporary JS file containing the bootstrap code.
 * Bun's Blob URL workers break when the URL is revoked before the worker
 * fully initializes its message handler, so we use a file-based worker instead.
 */
function getBootstrapFile(): string {
  if (!bootstrapFile) {
    const dir = mkdtempSync(join(tmpdir(), 'puru-'))
    bootstrapFile = join(dir, 'worker.js')
    writeFileSync(bootstrapFile, WEB_BOOTSTRAP_CODE)
  }
  return bootstrapFile
}

class BunManagedWorker implements ManagedWorker {
  private worker: BunRuntimeWorker
  readonly id: number

  constructor() {
    this.id = ++workerIdCounter
    const WorkerConstructor = (globalThis as { Worker?: BunWorkerConstructor }).Worker
    if (!WorkerConstructor) {
      throw new Error('Bun Worker constructor is not available in this runtime')
    }
    this.worker = new WorkerConstructor(getBootstrapFile())
  }

  postMessage(data: WorkerMessage): void {
    this.worker.postMessage(data)
  }

  terminate(): Promise<number> {
    this.worker.terminate()
    // Web Worker terminate() is synchronous and void; return resolved 0
    return Promise.resolve(0)
  }

  on(event: 'message', handler: (data: WorkerResponse) => void): void
  on(event: 'error', handler: (err: Error) => void): void
  on(event: 'exit', handler: (code: number) => void): void
  on(event: 'message' | 'error' | 'exit', handler: ((data: WorkerResponse) => void) | ((err: Error) => void) | ((code: number) => void)): void {
    if (event === 'message') {
      this.worker.addEventListener('message', (e) => {
        ;(handler as (data: WorkerResponse) => void)(e.data)
      })
    } else if (event === 'error') {
      this.worker.addEventListener('error', (e) => {
        ;(handler as (err: Error) => void)(e.error ?? new Error(e.message))
      })
    } else if (event === 'exit') {
      // Bun emits 'close' on worker termination; the event carries a numeric exit code
      this.worker.addEventListener('close', (e) => {
        ;(handler as (code: number) => void)(e.code ?? 0)
      })
    }
  }

  unref(): void {
    // Bun Workers support unref() — not in standard Web Worker types
    if ('unref' in this.worker && typeof (this.worker as { unref?: () => void }).unref === 'function') {
      (this.worker as { unref(): void }).unref()
    }
  }

  ref(): void {
    // Bun Workers support ref() — not in standard Web Worker types
    if ('ref' in this.worker && typeof (this.worker as { ref?: () => void }).ref === 'function') {
      (this.worker as { ref(): void }).ref()
    }
  }
}

export class BunWorkerAdapter implements WorkerAdapter {
  createWorker(): ManagedWorker {
    return new BunManagedWorker()
  }
}

/** Clean up the temporary bootstrap file. Called during pool drain. */
export function cleanupBootstrapFile(): void {
  if (bootstrapFile) {
    try { unlinkSync(bootstrapFile) } catch {}
    bootstrapFile = null
  }
}
