/** Runtime detected for the current process. */
export type Runtime = "node" | "deno" | "bun" | "browser";
/** Threading capability detected for the current process. */
export type Capability = "full-threads" | "single-thread";

/** Detect the current JavaScript runtime. Useful for diagnostics and feature gating. */
export function detectRuntime(): Runtime {
  if ("Bun" in globalThis) return "bun";
  if ("Deno" in globalThis) return "deno";
  if (typeof globalThis.process !== "undefined" && globalThis.process.versions?.node) return "node";
  return "browser";
}

/**
 * Detect whether the current runtime can execute threaded work.
 *
 * In practice, puru expects `full-threads` environments such as Node.js or Bun.
 */
export function detectCapability(): Capability {
  const runtime = detectRuntime();
  if (runtime === "node" || runtime === "bun") return "full-threads";
  if ("Worker" in globalThis) return "full-threads";
  return "single-thread";
}
