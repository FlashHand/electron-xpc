# electron-xpc

**Async/Await** Style Cross-Process Communication, built on semaphore-based flow control.

Unlike Electron's built-in `ipcRenderer.invoke` / `ipcMain.handle`, which only supports renderer-to-main request–response, XPC enables **any process** (renderer, main, or utility process) to call handlers registered in **any other process** with full `async/await` semantics — including `renderer <-> renderer`, `main <-> renderer`, and `utility <-> anything` invocations.

## Install

```bash
yarn add electron-xpc
# or
npm install electron-xpc
```

**Features:**

1. **Offload work to renderer processes** — Heavy or blocking tasks can be delegated to a preload script running in a hidden renderer window, keeping the main process responsive and reducing its performance overhead.
2. **Unified async/await across all processes** — Since every inter-process call supports `async/await`, complex multi-step workflows that span multiple processes can be orchestrated with straightforward sequential logic, eliminating deeply nested callbacks or manual event coordination.


## 中文简介

### electron-xpc是 **Async/Await** 语法风格的跨进程通信库，基于信号量控制的方式开发

不同于 Electron 内置的 `ipcRenderer.invoke` / `ipcMain.handle` 仅支持渲染进程到主进程的请求-响应模式，XPC 允许**任意进程**（渲染进程、主进程或工具进程）以完整的 `async/await` 语义调用**任意其他进程**中注册的handler——包括 renderer <-> renderer、main <-> renderer 以及 utility <-> 任意进程 的调用。

**特性：**

1. **将工作分配到渲染进程** — 可以将耗时或阻塞性任务委托到渲染进程中执行，保持主进程的响应性，降低主进程的性能开销。
2. **任意进程间统一的 async/await 语法** — 由于所有跨进程调用均支持 `async/await`，跨多个进程的复杂多步作业流程可以用简洁的顺序逻辑编排，无需深层嵌套回调或手动事件协调。


### Process Layers

XPC distinguishes four process layers in an Electron app:

| Layer | Environment | Import Path |
|-------|-------------|-------------|
| **Main Layer** | Node.js main process | `electron-xpc/main` |
| **Preload Layer** | Renderer preload script (has `electron` access) | `electron-xpc/preload` |
| **Web Layer** | Renderer web page (no `electron` access, uses `window.xpcRenderer`) | `electron-xpc/renderer` |
| **Utility Process Layer** | Sandboxed Node.js child process | `electron-xpc/utilityProcess` |

Although preload belongs to the renderer layer, it contains an isolated Node.js context, so it is treated as a separate layer in the architecture.

---

## Usage A: Hard-coded send / handle

This is the low-level API where you manually specify channel name strings.

### 1. Initialize XPC Center in Main Process (Required)

```ts
// src/main/index.ts
import { xpcCenter } from 'electron-xpc/main';

xpcCenter.init();
```

### 2. Register & Send in Main Layer

```ts
import { xpcMain } from 'electron-xpc/main';

// Register a handler
xpcMain.handle('my/mainChannel', async (payload) => {
  console.log('Main received:', payload.params);
  return { message: 'Hello from main' };
});

// Send to any registered handler (main or renderer)
const result = await xpcMain.send('my/channel', { foo: 'bar' });
```

### 3. Register & Send in Preload Layer

```ts
// Preload script — has direct electron access
import { xpcRenderer } from 'electron-xpc/preload';

// Register a handler
xpcRenderer.handle('my/channel', async (payload) => {
  console.log('Received params:', payload.params);
  return { message: 'Hello from preload' };
});

// Send to other handlers
const result = await xpcRenderer.send('other/channel', { foo: 'bar' });
```

### 4. Register & Send in Web Layer

```ts
// Web page — no electron access, uses window.xpcRenderer
import { xpcRenderer } from 'electron-xpc/renderer';

// Register a handler
xpcRenderer.handle('my/webChannel', async (payload) => {
  return { message: 'Hello from web' };
});

// Send to other handlers
const result = await xpcRenderer.send('my/channel', { foo: 'bar' });
```

### 5. Remove a Handler

```ts
xpcRenderer.removeHandle('my/channel');
```

---

## Usage B: Handler / Emitter Pattern (Recommended)

The Handler/Emitter pattern provides **type-safe**, **auto-registered** channels. Channel names are automatically generated from class and method names — no hard-coded strings needed.

Channel naming convention: `xpc:ClassName/methodName`

> **⚠️ Important: Handler methods accept at most 1 parameter.** Since `send()` can only carry a single `params` value, multi-parameter methods are not supported. The type system enforces this constraint — methods with 2+ parameters are mapped to `never` in the Emitter type, causing a compile error.

### Main Layer

```ts
import { XpcMainHandler, createXpcMainEmitter } from 'electron-xpc/main';

// --- Define Handler ---
class UserService extends XpcMainHandler {
  // ✅ 0 params — valid
  async getCount(): Promise<number> {
    return 42;
  }

  // ✅ 1 param — valid
  async getUserList(params: { page: number }): Promise<any[]> {
    return db.query('SELECT * FROM users LIMIT ?', [params.page]);
  }

  // ❌ 2+ params — compile error on the Emitter side
  // async search(keyword: string, page: number): Promise<any> { ... }
}

// Instantiate — auto-registers:
//   xpc:UserService/getCount
//   xpc:UserService/getUserList
const userService = new UserService();
```

```ts
// --- Use Emitter (can be used from any layer) ---
import { createXpcMainEmitter } from 'electron-xpc/main';
import type { UserService } from './somewhere';

const userEmitter = createXpcMainEmitter<UserService>('UserService');

const count = await userEmitter.getCount();           // sends to xpc:UserService/getCount
const list = await userEmitter.getUserList({ page: 1 }); // sends to xpc:UserService/getUserList
```

### Preload Layer

```ts
import { XpcPreloadHandler, createXpcPreloadEmitter } from 'electron-xpc/preload';

// --- Define Handler ---
class MessageTable extends XpcPreloadHandler {
  async getMessageList(params: { chatId: string }): Promise<any[]> {
    return sqlite.query('SELECT * FROM messages WHERE chatId = ?', [params.chatId]);
  }
}

// Instantiate — auto-registers: xpc:MessageTable/getMessageList
const messageTable = new MessageTable();
```

```ts
// --- Use Emitter (from other preload or web layer) ---
import { createXpcPreloadEmitter } from 'electron-xpc/preload';
import type { MessageTable } from './somewhere';

const messageEmitter = createXpcPreloadEmitter<MessageTable>('MessageTable');
const messages = await messageEmitter.getMessageList({ chatId: '123' });
```

### Web Layer

```ts
import { XpcRendererHandler, createXpcRendererEmitter } from 'electron-xpc/renderer';

// --- Define Handler ---
class UINotification extends XpcRendererHandler {
  async showToast(params: { text: string }): Promise<void> {
    toast.show(params.text);
  }
}

const uiNotification = new UINotification();
```

```ts
// --- Use Emitter (from other layers) ---
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { UINotification } from './somewhere';

const notifyEmitter = createXpcRendererEmitter<UINotification>('UINotification');
await notifyEmitter.showToast({ text: 'Hello!' });
```

---

## Broadcast & Subscribe

Fire-and-forget one-to-many notifications for event-driven communication.

### Key Rules

1. **The sender does NOT receive its own broadcast**
2. **Subscribers receive `payload.params`, not direct params**

### Main Process

```ts
import { xpcMain } from 'electron-xpc/main';

// Broadcast to all renderer windows (main won't receive this)
xpcMain.broadcast('language/changed', { lang: 'en' });

// Subscribe to renderer broadcasts
xpcMain.subscribe('language/changed', (payload) => {
  const { lang } = payload.params;  // Access via payload.params
  console.log('Language:', lang);
});
```

### Renderer Process

```ts
import { xpcRenderer } from 'electron-xpc/renderer';

// Broadcast to all OTHER renderers + main (sender won't receive)
xpcRenderer.broadcast('language/changed', { lang: 'zh' });

// Subscribe to broadcasts from main or other renderers
xpcRenderer.subscribe('language/changed', (payload) => {
  const { lang } = payload.params;  // Access via payload.params
  console.log('Language:', lang);
});
```

### Utility Process

```ts
import { xpcUtilityProcess } from 'electron-xpc/utilityProcess';

// Broadcast to main + all renderers + all OTHER utility processes (sender won't receive)
xpcUtilityProcess.broadcast('language/changed', { lang: 'ja' });

// Subscribe to broadcasts from any other process
xpcUtilityProcess.subscribe('language/changed', (payload) => {
  const { lang } = payload.params;  // Access via payload.params
  console.log('Language:', lang);
});
```

A utility process does not need to own a single handler to take part — `subscribe()` and
`broadcast()` work on a process whose only job is to listen or to notify.

### Receivers Table

| Sender | API | Receivers |
|---|---|---|
| Main | `xpcMain.broadcast(event, params)` | All renderer windows + all subscribed utility processes (NOT main) |
| Renderer | `xpcRenderer.broadcast(event, params)` | All OTHER renderers + main + all subscribed utility processes (NOT sender) |
| Utility Process | `xpcUtilityProcess.broadcast(event, params)` | Main + all renderers + all OTHER utility processes (NOT sender) |

In every row the sender is excluded from its own broadcast, including the utility-process row: a
process that broadcasts and subscribes to the same event does not hear itself.

---

## Utility Process

Electron's [Utility Process](https://www.electronjs.org/docs/latest/api/utility-process) runs in a sandboxed Node.js environment, ideal for CPU-intensive or I/O-heavy work. `electron-xpc` integrates utility processes into the same XPC communication fabric — any renderer or main process can call a utility process handler using the same `send()` API.

### Process Layers for Utility Process

| Layer | Import Path |
|-------|-------------|
| **Main** (create & manage) | `electron-xpc/main` |
| **Utility Process** (handle & send) | `electron-xpc/utilityProcess` |

---

### Complete Minimal Example

Two files. Nothing else is required — no init call in the utility process, no manual `MessagePort`
handling, no `parentPort` code.

```ts
// ── main.ts ─────────────────────────────────────────────────────
import { app } from 'electron';
import { xpcCenter, createUtilityProcess, xpcMain } from 'electron-xpc/main';
import * as path from 'path';

app.whenReady().then(async () => {
  xpcCenter.init();                                        // once per app

  createUtilityProcess({                                   // once per utility process
    modulePath: path.join(__dirname, 'worker.js'),
    serviceName: 'my-worker',
  });

  // main → utility
  const sum = await xpcMain.send('worker/add', { a: 1, b: 2 });   // 3

  // main → everyone subscribed (utility processes included)
  xpcMain.broadcast('app/theme', { dark: true });
});
```

```ts
// ── worker.ts (the utility process) ─────────────────────────────
import { xpcUtilityProcess } from 'electron-xpc/utilityProcess';

// Callable from main, any renderer, and any other utility process
xpcUtilityProcess.handle('worker/add', async ({ params }) => params.a + params.b);

xpcUtilityProcess.subscribe('app/theme', ({ params }) => {
  console.log('[worker] theme:', params.dark);
});

// utility → anywhere
const answer = await xpcUtilityProcess.send('renderer/ask', { q: 'ready?' });
```

The utility process joins XPC by **importing the module** — the import installs a `process.parentPort`
listener that waits for the port `createUtilityProcess()` sends. There is no function to call.
`handle()` and `subscribe()` may therefore run at module top level, before the port arrives; they are
queued and replayed. `send()` and `broadcast()` may not — see [Error Semantics](#error-semantics).

---

### Step 1: Create the Utility Process in Main

```ts
// src/main/index.ts
import { createUtilityProcess } from 'electron-xpc/main';
import * as path from 'path';

app.whenReady().then(() => {
  xpcCenter.init();

  const worker = createUtilityProcess({
    modulePath: path.join(__dirname, 'worker.js'),
    serviceName: 'my-worker',
  });

  // Optional: pipe stdout/stderr to see console.log from utility process
  worker.child.stdout?.on('data', (data) => console.log('[worker]', data.toString()));
  worker.child.stderr?.on('data', (data) => console.error('[worker]', data.toString()));
});
```

> **Use `createUtilityProcess()`, not Electron's `utilityProcess.fork()`.** A natively forked child
> is a valid utility process but is *not* an XPC peer: `send()` to its handlers resolves `null`, and
> it receives no broadcasts. The reason is structural — the main side of the channel can only be
> claimed by whoever holds the `child` handle, and Electron emits no "utility process created" event
> for the library to hook (it has `child-process-gone`, but no counterpart for creation). So joining
> the process to XPC has to happen at the moment it is created, which is what this function is.

#### Options

`UtilityProcessOptions` extends Electron's [`ForkOptions`](https://www.electronjs.org/docs/latest/api/utility-process#utilityprocessforkmodulepath-args-options)
— everything Electron accepts is accepted here and forwarded unchanged.

| Option | Type | Notes |
|---|---|---|
| `modulePath` | `string` | **Required.** Script the utility process runs |
| `args` | `string[]` | Passed to the child as `process.argv` |
| `stdio` | `'pipe' \| 'ignore' \| 'inherit' \| Array` | **Defaults to `'pipe'`** so `child.stdout` / `child.stderr` are readable. Pass your own to override — `'inherit'` sends output straight to the terminal but leaves `child.stdout` `null` |
| `env`, `execArgv`, `cwd`, `serviceName`, `session`, `partition`, … | see Electron docs | Forwarded verbatim |

`serviceName` is worth setting: it is the name that appears in Activity Monitor / Task Manager and in
`app.getAppMetrics()`.

Returns `{ child, kill }`. Prefer the returned `kill()` over `child.kill()` — it unregisters the
process's routes *before* closing the port, so calls in flight toward it settle immediately instead
of waiting for the `exit` event.

---

### Step 2: Register Handlers in the Utility Process

Handlers registered via `xpcUtilityProcess.handle()` are automatically forwarded to `xpcCenter` in the main process and become callable from any layer (renderer, preload, main).

```ts
// src/utility/worker.ts
import { xpcUtilityProcess } from 'electron-xpc/utilityProcess';

// Handlers can be registered at top-level before the MessagePort is initialized.
// They are queued and replayed automatically once the port is ready.
xpcUtilityProcess.handle('worker/processData', async (payload) => {
  console.log('[worker] received:', payload.params);
  const result = heavyComputation(payload.params.input);
  return { result };
});

xpcUtilityProcess.handle('worker/getStatus', async () => {
  return { status: 'idle', uptime: process.uptime() };
});
```

---

### Step 3: Call Utility Process Handlers from Any Layer

Once registered, any process can call the handler with the same `send()` API:

**From Renderer / Preload:**
```ts
import { xpcRenderer } from 'electron-xpc/preload'; // or 'electron-xpc/renderer'

const result = await xpcRenderer.send('worker/processData', { input: 'hello' });
console.log(result); // { result: '...' }
```

**From Main Process:**
```ts
import { xpcMain } from 'electron-xpc/main';

const status = await xpcMain.send('worker/getStatus');
console.log(status); // { status: 'idle', uptime: 42 }
```

---

### Step 4: Send from Utility Process to Other Handlers

The utility process can also call handlers registered in the main or renderer processes:

```ts
// src/utility/worker.ts
import { xpcUtilityProcess } from 'electron-xpc/utilityProcess';

xpcUtilityProcess.handle('worker/doSomething', async (payload) => {
  // Call a handler registered in renderer or main
  const rendererResult = await xpcUtilityProcess.send('renderer/hello', { from: 'worker' });
  console.log('[worker] renderer replied:', rendererResult);
  return { done: true };
});
```

**Renderer side:**
```ts
import { xpcRenderer } from 'electron-xpc/preload';

xpcRenderer.handle('renderer/hello', async (payload) => {
  console.log('[renderer] called by worker with:', payload.params);
  return 'hello from renderer';
});
```

`send()` from a utility process reaches **any** layer — main, renderer, another utility process, or a
handler the utility process registered itself. The reply is matched by the task id the utility
process minted, so concurrent calls do not cross.

---

### Step 5: Broadcast & Subscribe from a Utility Process

```ts
// src/utility/worker.ts
import { xpcUtilityProcess } from 'electron-xpc/utilityProcess';

// Reaches main + all renderers + all OTHER utility processes. Never the sender.
xpcUtilityProcess.broadcast('worker/progress', { done: 42, total: 100 });

xpcUtilityProcess.subscribe('app/shutdown', (payload) => {
  console.log('[worker] shutting down:', payload.params);
});
```

See [Broadcast & Subscribe → Receivers Table](#receivers-table) for who receives what.

---

### Lifecycle

When a utility process exits — cleanly, by `kill()`, or by crashing — `xpcCenter` drops everything
that belonged to it:

| On exit | Effect |
|---|---|
| Handlers it registered | Removed from the registry. A later `send()` to one of those names takes the "no owner" path and resolves `null` |
| Subscriptions it held | Removed. Later broadcasts skip it |
| `send()` calls in flight toward it | Settled with `null` immediately, instead of waiting for a reply that will never arrive |
| Other utility processes | Untouched — cleanup is scoped to the exiting process's port |

Cleanup is idempotent, so `kill()` followed by the `'exit'` event is safe.

---

### Error Semantics

Every routing outcome resolves rather than throws. `send()` returns `null` when the handleName has
no owner, when the owner has exited, or when the remote handler itself throws — callers never need a
`try/catch` around a routing failure.

The one exception is calling `xpcUtilityProcess.send()` or `.broadcast()` **before the MessagePort
arrives**, which throws `MessagePort not initialized`. `handle()` and `subscribe()` do not have this
problem: they queue and replay once the port is ready. So a utility process whose first action is a
`broadcast()` — no handler, no subscription — must retry until the call stops throwing. There is
currently no readiness signal to await.

---

### Communication Flow (with Utility Process)

```
Renderer / Main                Main Process (xpcCenter)         Utility Process
      |                                |                               |
      |  xpcRenderer.handle(...)       |                               |
      |  __xpc_register__ -----------> |                               |
      |                                |                               |
      |                                |   xpcUtilityProcess.handle()  |
      |                                | <-- __xpc_register__ (port2) -|
      |                                |   registerPortHandler(name)   |
      |                                |                               |
      |  xpcRenderer.send('worker/x') |                               |
      |  __xpc_exec__ ---------------> |                               |
      |                                |  port2.postMessage(exec) ---> |
      |                                |  [semaphore blocks]           |  execute handler
      |                                | <-- port1.postMessage(finish)-|
      |                                |  [semaphore unblocks]         |
      |  <---- return result --------- |                               |
      |                                |                               |
      |                                |  xpcUtilityProcess.send(...)  |
      |                                | <-- __xpc_exec__ (port1) ---- |
      |  <---- forward(name) --------- |                               |
      |  execute handler               |                               |
      |  __xpc_finish__ ------------>  |                               |
      |                                |  ----> return result (port2) -|
```

---

## Architecture

### Communication Flow

```
Preload A / Web A               Main Process              Preload B / Web B
    |                              |                              |
    |  handle(name, handler) ----> |                              |
    |  __xpc_register__            |                              |
    |                              |   <---- send(name, params)   |
    |                              |         __xpc_exec__         |
    |   <---- forward(name) ----   |                              |
    |         execute handler      |                              |
    |   ---- __xpc_finish__ ---->  |                              |
    |                              |   ----> return result        |

Main Process (xpcMain)
    |                              |
    |  handle(name, handler)       |  -- register in xpcCenter registry (id=0)
    |  send(name, params) -------> |  -- delegate to xpcCenter.exec()
    |                              |     id=0: call local handler directly
    |                              |     else: forward to renderer, block until done
```

---

## Changes in 1.2.0

The utility process became a full XPC peer: it can `send()` to main, renderers, other utility
processes and itself; main and renderers can `send()` to it; and all three sender kinds take part in
`broadcast()` / `subscribe()`. Routes and in-flight calls are cleaned up when a utility process exits.

`UtilityProcessOptions` now extends Electron's `ForkOptions`, so `cwd`, `session`, `partition` and
the rest are forwarded instead of silently dropped, and the previously hard-coded `stdio: 'pipe'` is
a default you can override.

**Internal signature change.** `xpcCenter.registerPortHandler(handleName, port2)` is now
`registerPortHandler(handleName, portId)`, and `xpcCenter.registerPort(port)` is new. `xpcCenter` is
exported from `electron-xpc/main`, so this is recorded here even though both methods are internal by
intent — no documented consumer API changed.

---

## Contributing

`yarn test:app` builds the package and launches a manual Electron harness in `test/` that exercises
the twelve cross-process cases (utility egress, ingress, broadcast self-exclusion, and lifecycle) with
one clickable button each.

## License

MIT
