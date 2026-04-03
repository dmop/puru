import { availableParallelism } from 'node:os'
import type { PuruConfig } from './types.js'

const DEFAULT_CONFIG: PuruConfig = {
  maxThreads: availableParallelism?.() ?? 4,
  strategy: 'fifo',
  idleTimeout: 30_000,
  adapter: 'auto',
  concurrency: 64,
}

let currentConfig: PuruConfig = { ...DEFAULT_CONFIG }
let configLocked = false

export function configure(opts: Partial<PuruConfig>): void {
  if (configLocked) {
    throw new Error(
      'configure() must be called before the first spawn(). The worker pool has already been initialized.',
    )
  }
  currentConfig = { ...currentConfig, ...opts }
}

export function getConfig(): PuruConfig {
  configLocked = true
  return { ...currentConfig }
}

/** @internal For testing only */
export function resetConfig(): void {
  currentConfig = { ...DEFAULT_CONFIG }
  configLocked = false
}
