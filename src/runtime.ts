export type Runtime = "node" | "deno" | "bun" | "browser";
export type Capability = "full-threads" | "single-thread";

export function detectRuntime(): Runtime {
  if ("Bun" in globalThis) return "bun";
  if ("Deno" in globalThis) return "deno";
  if (typeof globalThis.process !== "undefined" && globalThis.process.versions?.node) return "node";
  return "browser";
}

export function detectCapability(): Capability {
  const runtime = detectRuntime();
  if (runtime === "node" || runtime === "bun") return "full-threads";
  if ("Worker" in globalThis) return "full-threads";
  return "single-thread";
}
