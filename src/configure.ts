import { availableParallelism } from "node:os";
import type { PuruConfig } from "./types.js";

const DEFAULT_CONFIG: PuruConfig = {
  maxThreads: availableParallelism?.() ?? 4,
  strategy: "fifo",
  idleTimeout: 30_000,
  adapter: "auto",
  concurrency: 64,
};

let currentConfig: PuruConfig = { ...DEFAULT_CONFIG };
let configLocked = false;

/**
 * Configure the global thread pool. **Must be called before the first `spawn()`.**
 *
 * After the pool is initialized, calling `configure()` throws. Call it once at
 * application startup or in test setup.
 *
 * @example
 * configure({
 *   maxThreads: 4,          // default: os.availableParallelism()
 *   concurrency: 64,        // max concurrent tasks per shared worker (default: 64)
 *   idleTimeout: 30_000,    // kill idle workers after 30s (default: 30_000)
 *   adapter: 'auto',        // 'auto' | 'node' | 'bun' | 'inline' (default: 'auto')
 * })
 *
 * @example
 * // In tests: run tasks on the main thread with no real workers
 * configure({ adapter: 'inline' })
 */
export function configure(opts: Partial<PuruConfig>): void {
  if (configLocked) {
    throw new Error(
      "configure() must be called before the first spawn(). The worker pool has already been initialized.",
    );
  }
  currentConfig = { ...currentConfig, ...opts };
}

export function getConfig(): PuruConfig {
  configLocked = true;
  return { ...currentConfig };
}

/** @internal For testing only */
export function resetConfig(): void {
  currentConfig = { ...DEFAULT_CONFIG };
  configLocked = false;
}
