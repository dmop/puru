export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue = null | string | number | boolean | JsonValue[] | JsonObject;

export interface StructuredCloneObject {
  [key: string]: StructuredCloneValue;
}

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

export type ChannelValue = Exclude<StructuredCloneValue, null>;
export type TaskError = Error | DOMException;
export type ChannelMap = Record<string, string>;

export interface PuruConfig {
  maxThreads: number;
  strategy: "fifo" | "work-stealing";
  idleTimeout: number;
  adapter: "auto" | "node" | "bun" | "inline";
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

export interface SpawnResult<T> {
  result: Promise<T>;
  cancel: () => void;
}
