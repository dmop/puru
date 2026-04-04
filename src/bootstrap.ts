/**
 * Channel proxy code shared between Node and Web bootstraps.
 * Injected at the top of the worker, inert unless channels are passed.
 */
const CHANNEL_PROXY_CODE = `
const __chCallbacks = new Map();
let __chRpcId = 0;

class __ChannelProxy {
  constructor(id) {
    this._id = id;
  }

  _rpc(op, value) {
    const correlationId = ++__chRpcId;
    return new Promise((resolve, reject) => {
      __chCallbacks.set(correlationId, { resolve, reject });
      __postMsg({
        type: 'channel-op',
        channelId: this._id,
        op,
        correlationId,
        value
      });
    });
  }

  send(value) {
    return this._rpc('send', value);
  }

  recv() {
    return this._rpc('recv', undefined);
  }

  close() {
    __postMsg({
      type: 'channel-op',
      channelId: this._id,
      op: 'close',
      correlationId: ++__chRpcId
    });
  }

  [Symbol.asyncIterator]() {
    const proxy = this;
    return {
      async next() {
        const value = await proxy.recv();
        if (value === null) return { done: true, value: undefined };
        return { done: false, value };
      }
    };
  }
}

function __handleChannelResult(msg) {
  if (msg.type === 'channel-result') {
    const cb = __chCallbacks.get(msg.correlationId);
    if (cb) {
      __chCallbacks.delete(msg.correlationId);
      if (msg.error) {
        cb.reject(new Error(msg.error));
      } else {
        cb.resolve(msg.value);
      }
    }
  }
}

function __buildChannelProxies(channels) {
  if (!channels) return undefined;
  const proxies = {};
  for (const name of Object.keys(channels)) {
    proxies[name] = new __ChannelProxy(channels[name]);
  }
  return proxies;
}

const __fnCache = new Map();
const __FN_CACHE_MAX = 1000;

function __execFn(fnStr, channels, args) {
  let parsedFn = __fnCache.get(fnStr);
  if (!parsedFn) {
    parsedFn = (new Function('return (' + fnStr + ')'))();
    if (__fnCache.size >= __FN_CACHE_MAX) __fnCache.delete(__fnCache.keys().next().value);
    __fnCache.set(fnStr, parsedFn);
  }
  if (args) {
    return parsedFn(...args);
  }
  if (channels) {
    return parsedFn(__buildChannelProxies(channels));
  }
  return parsedFn();
}
`;

/** Bootstrap code for Node.js workers (eval: true, CJS context) */
export const NODE_BOOTSTRAP_CODE = `
'use strict';
const { parentPort } = require('worker_threads');

const __postMsg = (d) => parentPort.postMessage(d);

${CHANNEL_PROXY_CODE}

const cancelledTasks = new Set();

parentPort.on('message', (msg) => {
  __handleChannelResult(msg);
});

parentPort.on('message', async (msg) => {
  if (msg.type === 'execute') {
    if (msg.concurrent) {
      (async () => {
        if (cancelledTasks.has(msg.taskId)) {
          cancelledTasks.delete(msg.taskId);
          return;
        }
        try {
          const result = await __execFn(msg.fnStr, msg.channels, msg.args);
          if (!cancelledTasks.has(msg.taskId)) {
            parentPort.postMessage({ type: 'result', taskId: msg.taskId, value: result });
          }
        } catch (error) {
          if (!cancelledTasks.has(msg.taskId)) {
            parentPort.postMessage({
              type: 'error',
              taskId: msg.taskId,
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            });
          }
        } finally {
          cancelledTasks.delete(msg.taskId);
        }
      })();
    } else {
      try {
        const result = await __execFn(msg.fnStr, msg.channels, msg.args);
        parentPort.postMessage({ type: 'result', taskId: msg.taskId, value: result });
      } catch (error) {
        parentPort.postMessage({
          type: 'error',
          taskId: msg.taskId,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }
  } else if (msg.type === 'cancel') {
    cancelledTasks.add(msg.taskId);
  } else if (msg.type === 'shutdown') {
    process.exit(0);
  }
});

parentPort.postMessage({ type: 'ready' });
`;

/** Bootstrap code for Bun/Web Workers (file-based, Web Worker API) */
export const WEB_BOOTSTRAP_CODE = `
const __postMsg = (d) => self.postMessage(d);

${CHANNEL_PROXY_CODE}

const cancelledTasks = new Set();

self.addEventListener('message', (event) => {
  __handleChannelResult(event.data);
});

self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === 'execute') {
    if (msg.concurrent) {
      (async () => {
        if (cancelledTasks.has(msg.taskId)) {
          cancelledTasks.delete(msg.taskId);
          return;
        }
        try {
          const result = await __execFn(msg.fnStr, msg.channels, msg.args);
          if (!cancelledTasks.has(msg.taskId)) {
            self.postMessage({ type: 'result', taskId: msg.taskId, value: result });
          }
        } catch (error) {
          if (!cancelledTasks.has(msg.taskId)) {
            self.postMessage({
              type: 'error',
              taskId: msg.taskId,
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            });
          }
        } finally {
          cancelledTasks.delete(msg.taskId);
        }
      })();
    } else {
      try {
        const result = await __execFn(msg.fnStr, msg.channels, msg.args);
        self.postMessage({ type: 'result', taskId: msg.taskId, value: result });
      } catch (error) {
        self.postMessage({
          type: 'error',
          taskId: msg.taskId,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }
  } else if (msg.type === 'cancel') {
    cancelledTasks.add(msg.taskId);
  } else if (msg.type === 'shutdown') {
    self.close();
  }
};

self.postMessage({ type: 'ready' });
`;

/** @deprecated Use NODE_BOOTSTRAP_CODE instead */
export const BOOTSTRAP_CODE = NODE_BOOTSTRAP_CODE;
