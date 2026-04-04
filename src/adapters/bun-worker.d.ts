import type { WorkerMessage } from "../types.js";

// Minimal Web Worker types for the Bun adapter.
// These are available at runtime in Bun but not in @types/node.

interface BunWorkerInstance {
  postMessage(data: WorkerMessage, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(type: "message", handler: (e: MessageEvent) => void): void;
  addEventListener(type: "error", handler: (e: ErrorEvent) => void): void;
  addEventListener(type: "close", handler: (e: CloseEvent) => void): void;
  addEventListener(type: string, handler: (e: Event) => void): void;
  unref?(): void;
  ref?(): void;
}

declare var Worker: {
  new (url: string | URL): BunWorkerInstance;
};

declare interface Worker extends BunWorkerInstance {}

interface ErrorEvent extends Event {
  message: string;
  error?: Error;
}

interface CloseEvent extends Event {
  code: number;
}
