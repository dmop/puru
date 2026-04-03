export type Runtime = 'node' | 'deno' | 'bun' | 'browser'
export type Capability = 'full-threads' | 'single-thread'

/* eslint-disable @typescript-eslint/no-explicit-any */
export function detectRuntime(): Runtime {
  if (typeof (globalThis as any).Bun !== 'undefined') return 'bun'
  if (typeof (globalThis as any).Deno !== 'undefined') return 'deno'
  if (
    typeof globalThis.process !== 'undefined' &&
    globalThis.process.versions?.node
  )
    return 'node'
  return 'browser'
}

export function detectCapability(): Capability {
  const runtime = detectRuntime()
  if (runtime === 'node' || runtime === 'bun') return 'full-threads'
  if (typeof (globalThis as any).Worker !== 'undefined') return 'full-threads'
  return 'single-thread'
}
