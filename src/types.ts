/**
 * JSON object shape accepted by `task()` arguments.
 *
 * Use this for values that must survive `JSON.stringify()` / `JSON.parse()`.
 */
export interface JsonObject {
  [key: string]: JsonValue;
}

/** JSON-serializable value accepted by `task()` arguments. */
export type JsonValue = null | string | number | boolean | JsonValue[] | JsonObject;

/** Object shape supported by the structured clone algorithm. */
export interface StructuredCloneObject {
  [key: string]: StructuredCloneValue;
}

/**
 * Value that can cross the worker boundary in `spawn()` results, channel messages,
 * and other thread-to-thread communication.
 *
 * This models the browser/Node structured clone algorithm rather than JSON.
 */
export type StructuredCloneValue =
  | void
  | null
  | undefined
  | string
  | number
  | boolean
  | bigint
  | Date
  | RegExp
  | Error
  | ArrayBuffer
  | ArrayBufferView
  | StructuredCloneValue[]
  | Map<StructuredCloneValue, StructuredCloneValue>
  | Set<StructuredCloneValue>
  | StructuredCloneObject;

/** Channel values must be structured-cloneable and cannot be `null`. */
export type ChannelValue = Exclude<StructuredCloneValue, null>;
/** Error shape used when a task fails or is cancelled. */
export type TaskError = Error | DOMException;
export type ChannelMap = Record<string, string>;

/**
 * Global configuration for the puru worker pool.
 *
 * Apply it once with `configure()` before the first task runs.
 */
export interface PuruConfig {
  /** Maximum number of exclusive worker threads in the pool. */
  maxThreads: number;
  /** Queue strategy for exclusive tasks. */
  strategy: "fifo" | "work-stealing";
  /** Milliseconds an idle worker stays alive before being torn down. */
  idleTimeout: number;
  /** Worker backend selection. Use `inline` for tests. */
  adapter: "auto" | "node" | "bun" | "inline";
  /** Maximum concurrent tasks per shared worker in `{ concurrent: true }` mode. */
  concurrency: number;
}

export interface Task {
  id: string;
  fnId: string;
  fnStr: string;
  args?: JsonValue[];
  resolve: (value: StructuredCloneValue) => void;
  reject: (reason: TaskError) => void;
  priority: "low" | "normal" | "high";
  concurrent: boolean;
  channels?: ChannelMap;
}

export type WorkerMessage =
  | {
      type: "execute";
      taskId: string;
      fnId: string;
      fnStr?: string;
      args?: JsonValue[];
      concurrent: boolean;
      channels?: ChannelMap;
    }
  | { type: "cancel"; taskId: string }
  | { type: "shutdown" }
  | { type: "channel-result"; correlationId: number; value?: StructuredCloneValue; error?: string };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "result"; taskId: string; value: StructuredCloneValue }
  | { type: "error"; taskId: string; message: string; stack?: string }
  | {
      type: "channel-op";
      channelId: string;
      op: "send" | "recv" | "close";
      correlationId: number;
      value?: ChannelValue;
    };

/** Handle returned from `spawn()`. */
export interface SpawnResult<T> {
  /** Promise for the worker result. */
  result: Promise<T>;
  /** Cancel the task if it has not settled yet. */
  cancel: () => void;
}
