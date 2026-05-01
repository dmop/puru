---
id: how-it-works
title: How puru Works
sidebar_position: 2
---

# How puru Works Under the Hood

This document explains the internal architecture of `puru` with diagrams. If you just want to use the library, see the [API Reference](/docs/api). If you want help choosing the right abstraction, start with [Choosing the Right Primitive](/docs/guides/choosing-primitives).

The diagrams here explain behavior and tradeoffs. They are not a promise that every internal detail is stable public API.

## Architecture Overview

```mermaid
graph TB
    subgraph "Main Thread"
        User["User Code"]
        Spawn["spawn() / task()"]
        Pool["WorkerPool (singleton)"]
        Config["configure()"]
        ChReg["Channel Registry"]

        subgraph "Priority Queues"
            EQ["Exclusive Queues<br/>high | normal | low"]
            CQ["Concurrent Queues<br/>high | normal | low"]
        end
    end

    subgraph "Worker Threads"
        W1["Worker 1<br/>(exclusive)"]
        W2["Worker 2<br/>(exclusive)"]
        W3["Worker 3<br/>(shared)"]
    end

    User --> Spawn
    Config -.->|locked after first spawn| Pool
    Spawn -->|serialize fn + submit task| Pool
    Pool --> EQ
    Pool --> CQ
    EQ -->|assign| W1
    EQ -->|assign| W2
    CQ -->|assign| W3
    W1 <-->|messages| Pool
    W2 <-->|messages| Pool
    W3 <-->|messages| Pool
    ChReg <-.->|channel RPC| W3
```

## The Two Execution Modes

puru routes every task into one of two modes based on the `concurrent` option:

```mermaid
graph LR
    Task["spawn(fn)"]
    Task -->|"concurrent: false<br/>(default)"| Exclusive
    Task -->|"concurrent: true"| Concurrent

    subgraph Exclusive ["Exclusive Mode (CPU-bound)"]
        direction TB
        EW1["Worker"] --- ET1["Task A"]
        EW2["Worker"] --- ET2["Task B"]
        EW3["Worker"] --- ET3["Task C"]
    end

    subgraph Concurrent ["Concurrent Mode (I/O-bound)"]
        direction TB
        SW1["Worker"]
        SW1 --- CT1["Task D"]
        SW1 --- CT2["Task E"]
        SW1 --- CT3["Task F"]
        SW1 --- CT4["Task G"]
    end
```

| | Exclusive (default) | Concurrent |
|---|---|---|
| **Best for** | CPU-heavy work (> 5ms) | Async / I/O work |
| **Worker usage** | 1 worker = 1 task | 1 worker = up to 64 tasks |
| **Blocking OK?** | Yes (own thread) | No (blocks other tasks) |
| **Cancellation** | Terminates the worker | Sends cancel message |

## Task Lifecycle

Every task goes through these stages from the moment you call `spawn()`:

```mermaid
sequenceDiagram
    participant U as User Code
    participant S as spawn()
    participant P as WorkerPool
    participant W as Worker Thread

    U->>S: spawn(fn, opts?)
    S->>S: serializeFunction(fn)
    Note over S: Converts fn.toString()<br/>Validates: no native code,<br/>no class methods

    S->>P: pool.submit(task)

    alt Idle worker available
        P->>W: postMessage({ type: 'execute', fnStr, taskId })
    else Under maxThreads limit
        P->>P: Create new worker
        P->>W: postMessage({ type: 'execute', fnStr, taskId })
    else Pool at capacity
        P->>P: Queue task by priority
        Note over P: Waits until a worker<br/>becomes available
    end

    W->>W: new Function('return (' + fnStr + ')()')()
    W->>W: await result

    alt Success
        W->>P: postMessage({ type: 'result', taskId, value })
        P->>U: resolve(value)
    else Error
        W->>P: postMessage({ type: 'error', taskId, message })
        P->>U: reject(error)
    end

    P->>P: assignNextOrIdle(worker)
```

## Worker Pool Internals

The pool manages three collections of workers and routes tasks through priority queues:

```mermaid
graph TB
    subgraph Pool ["WorkerPool"]
        direction TB

        subgraph Collections ["Worker Collections"]
            Idle["idleWorkers[]<br/>Waiting for work"]
            Excl["exclusiveWorkers<br/>Map&lt;taskId, worker&gt;"]
            Shared["sharedWorkers<br/>Map&lt;worker, Set&lt;taskId&gt;&gt;"]
        end

        subgraph Queues ["Task Queues"]
            direction LR
            subgraph EQueues ["Exclusive"]
                EH["high"]
                EN["normal"]
                EL["low"]
            end
            subgraph CQueues ["Concurrent"]
                CH["high"]
                CN["normal"]
                CL["low"]
            end
        end
    end

    NewTask["New Task"] --> Pool
    Pool -->|exclusive task| EQueues
    Pool -->|concurrent task| CQueues
    EQueues -->|dequeue| Excl
    CQueues -->|dequeue| Shared
    Excl -->|task done| Idle
    Shared -->|all tasks done| Idle
    Idle -->|timeout| Terminated["terminate()"]
```

### Scheduling Algorithm

When a worker finishes a task:

```mermaid
flowchart TD
    Done["Task completed"] --> CheckExcl{"Exclusive\nqueue empty?"}

    CheckExcl -->|No| AssignExcl["Dequeue: high → normal → low\nAssign to this worker"]
    CheckExcl -->|Yes| CheckConc{"Concurrent\nqueue empty?"}

    CheckConc -->|No| AssignConc["Dequeue concurrent tasks\nFill up to concurrency limit"]
    CheckConc -->|Yes| GoIdle["Move worker to idleWorkers[]"]

    GoIdle --> Unref["worker.unref()\n(won't keep process alive)"]
    Unref --> Timer["Start idle timeout\n(default: 30s)"]
    Timer --> Kill["terminate() worker"]
```

## Worker Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Creating: pool needs a worker
    Creating --> Ready: worker posts 'ready'
    Ready --> Executing: task assigned
    Executing --> Ready: task done, more work queued
    Executing --> Idle: task done, no queued work
    Idle --> Executing: new task submitted
    Idle --> Terminated: idle timeout (30s)
    Executing --> Terminated: cancel (exclusive mode)
    Terminated --> [*]

    note right of Creating
        Workers are lazily created,
        never pre-spawned
    end note

    note right of Idle
        worker.unref() called,
        won't prevent process exit
    end note
```

## Channel Communication (Cross-Thread RPC)

Channels enable Go-style communication between worker threads and the main thread. Since workers can't share memory, puru uses an RPC bridge:

```mermaid
sequenceDiagram
    participant W as Worker Thread
    participant B as Bootstrap (in worker)
    participant P as Pool (main thread)
    participant C as Channel (main thread)

    Note over W: Worker calls ch.send(value)
    W->>B: ch.send(value)
    B->>P: postMessage({<br/>  type: 'channel-op',<br/>  op: 'send',<br/>  channelId,<br/>  correlationId,<br/>  value<br/>})

    P->>C: channel.send(value)

    alt Buffer has room
        C-->>P: resolves immediately
    else Buffer full
        C-->>P: blocks until receiver ready
    end

    P->>W: postMessage({<br/>  type: 'channel-result',<br/>  correlationId,<br/>  value: undefined<br/>})
    B->>W: send() promise resolves
```

### Channel Buffer Mechanics

```mermaid
graph LR
    subgraph "chan&lt;T&gt;(bufferSize)"
        direction TB
        SQ["sendQueue[]<br/>Blocked senders"]
        Buf["buffer[]<br/>Buffered values"]
        RQ["recvQueue[]<br/>Blocked receivers"]
    end

    Sender1["send(value)"] -->|buffer has room| Buf
    Sender2["send(value)"] -->|buffer full| SQ
    Buf -->|has value| Receiver1["recv()"]
    RQ -->|no value available| Receiver2["recv() waiting"]
    SQ -.->|receiver arrives| Receiver1
    Sender1 -.->|recv waiting| RQ
```

**send(value):**
1. If a receiver is waiting → deliver directly
2. If buffer has room → buffer the value
3. Otherwise → sender blocks until space opens

**recv():**
1. If buffer has a value → take it (and unblock a pending sender)
2. If a sender is waiting → take directly
3. If channel is closed → return `null`
4. Otherwise → receiver blocks until a value arrives

## Function Serialization

The core trick that makes puru ergonomic: you write inline functions, and they get serialized to strings and sent to workers.

```mermaid
graph LR
    subgraph "Main Thread"
        Fn["() => {\n  let sum = 0\n  for (let i = 0; i < 1e9; i++) sum += i\n  return sum\n}"]
        Ser["serializeFunction()"]
        Fn --> Ser
        Ser -->|"fn.toString()"| FnStr["function string"]
    end

    FnStr -->|postMessage| Worker

    subgraph "Worker Thread"
        Worker["new Function(\n  'return (' + fnStr + ')()'\n)()"]
        Result["result: 499999999500000000"]
        Worker --> Result
    end
```

### Validation checks

`serializeFunction()` rejects:
- **Native functions** - `[native code]` in toString output
- **Class methods** - ambiguous shorthand syntax
- **Tampered toString** - guards against prototype tampering

### The Big Rule

```mermaid
graph TD
    subgraph "Main Thread Scope"
        X["const x = 42"]
        Bad["spawn(() => x + 1)"]
        Good["spawn(() => {\n  const x = 42\n  return x + 1\n})"]
    end

    X -.->|"captured variable"| Bad
    Bad -->|"ReferenceError: x is not defined"| Fail["Fails"]
    Good -->|"self-contained"| OK["Works"]

    style Bad fill:#fee,stroke:#c33
    style Fail fill:#fee,stroke:#c33
    style Good fill:#efe,stroke:#3c3
    style OK fill:#efe,stroke:#3c3
```

Functions are serialized as **text** — they lose all closure bindings. Everything the function needs must be defined inside it, or passed via the `channels` option.

## Runtime Adapters

puru adapts to different JavaScript runtimes using the Strategy pattern:

```mermaid
graph TB
    Pool["WorkerPool"]
    Pool --> Adapter{"WorkerAdapter"}

    Adapter -->|Node.js| Node["NodeAdapter<br/>worker_threads<br/>eval: true"]
    Adapter -->|Bun| Bun["BunAdapter<br/>Web Workers<br/>file-based bootstrap"]
    Adapter -->|Testing| Inline["InlineAdapter<br/>Main thread execution<br/>No real workers"]

    Node --> NW["Worker(code, { eval: true })"]
    Bun --> BW["new Worker(file)"]
    Inline --> IW["Direct function call"]
```

Each adapter implements `createWorker()` which returns a `ManagedWorker` with a unified interface for `postMessage`, `on('message')`, `terminate()`, `ref()`, and `unref()`.

## Key Design Decisions

| Decision | Why |
|---|---|
| **Lazy worker creation** | Don't pay for threads you don't use. Workers are created on demand, not pre-spawned. |
| **Function serialization** | No separate worker files. Write logic inline and it gets sent to the worker as a string. Trade-off: no closures. |
| **Dual-mode pool** | CPU work needs isolation (exclusive). I/O work needs throughput (concurrent/shared). One pool handles both. |
| **Channel RPC bridge** | Workers can't share channel objects. The bootstrap layer proxies channel operations back to the main thread via structured messages. |
| **Priority queues** | Critical tasks can jump ahead without complex scheduling. Simple three-tier FIFO. |
| **Idle timeout + unref** | Workers clean themselves up. Process exits naturally when no work remains. |
| **Adapter pattern** | Node.js and Bun have different worker APIs. Adapters isolate this behind a common interface. |
| **Config lock** | Changing pool settings mid-flight would cause inconsistencies. Config is frozen after the first `spawn()`. |
