import { WEB_BOOTSTRAP_CODE } from '../bootstrap.js'
import type { ManagedWorker, WorkerAdapter } from './base.js'
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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
  private worker: Worker
  readonly id: number

  constructor() {
    this.id = ++workerIdCounter
    this.worker = new Worker(getBootstrapFile())
  }

  postMessage(data: unknown): void {
    this.worker.postMessage(data)
  }

  terminate(): Promise<number> {
    this.worker.terminate()
    // Web Worker terminate() is synchronous and void; return resolved 0
    return Promise.resolve(0)
  }

  on(event: 'message', handler: (data: unknown) => void): void
  on(event: 'error', handler: (err: Error) => void): void
  on(event: 'exit', handler: (code: number) => void): void
  on(event: string, handler: (...args: any[]) => void): void {
    if (event === 'message') {
      this.worker.addEventListener('message', (e: MessageEvent) => {
        handler(e.data)
      })
    } else if (event === 'error') {
      this.worker.addEventListener('error', (e: ErrorEvent) => {
        handler(e.error ?? new Error(e.message))
      })
    } else if (event === 'exit') {
      // Bun emits 'close' on worker termination
      this.worker.addEventListener('close', (e: CloseEvent) => {
        handler((e as any).code ?? 0)
      })
    }
  }

  unref(): void {
    // Bun Workers support unref()
    if ('unref' in this.worker && typeof this.worker.unref === 'function') {
      ;(this.worker as any).unref()
    }
  }

  ref(): void {
    // Bun Workers support ref()
    if ('ref' in this.worker && typeof this.worker.ref === 'function') {
      ;(this.worker as any).ref()
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
