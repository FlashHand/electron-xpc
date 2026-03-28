# electron-xpc

**Async/Await** Style Cross-Process Communication, built on semaphore-based flow control.

Unlike Electron's built-in `ipcRenderer.invoke` / `ipcMain.handle`, which only supports renderer-to-main request–response, XPC enables **any process** (renderer or main) to call handlers registered in **any other process** with full `async/await` semantics — including `renderer <-> renderer` and `main <-> renderer` invocations.

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

不同于 Electron 内置的 `ipcRenderer.invoke` / `ipcMain.handle` 仅支持渲染进程到主进程的请求-响应模式，XPC 允许**任意进程**（渲染进程或主进程）以完整的 `async/await` 语义调用**任意其他进程**中注册的handler——包括 renderer <-> renderer 和 main <-> renderer 的调用。

**特性：**

1. **将工作分配到渲染进程** — 可以将耗时或阻塞性任务委托到渲染进程中执行，保持主进程的响应性，降低主进程的性能开销。
2. **任意进程间统一的 async/await 语法** — 由于所有跨进程调用均支持 `async/await`，跨多个进程的复杂多步作业流程可以用简洁的顺序逻辑编排，无需深层嵌套回调或手动事件协调。


### Process Layers

XPC distinguishes three process layers in an Electron app:

| Layer | Environment | Import Path |
|-------|-------------|-------------|
| **Main Layer** | Node.js main process | `electron-xpc/main` |
| **Preload Layer** | Renderer preload script (has `electron` access) | `electron-xpc/preload` |
| **Web Layer** | Renderer web page (no `electron` access, uses `window.xpcRenderer`) | `electron-xpc/renderer` |

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

## Utility Process

Electron's [Utility Process](https://www.electronjs.org/docs/latest/api/utility-process) runs in a sandboxed Node.js environment, ideal for CPU-intensive or I/O-heavy work. `electron-xpc` integrates utility processes into the same XPC communication fabric — any renderer or main process can call a utility process handler using the same `send()` API.

### Process Layers for Utility Process

| Layer | Import Path |
|-------|-------------|
| **Main** (create & manage) | `electron-xpc/main` |
| **Utility Process** (handle & send) | `electron-xpc/utilityProcess` |

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

## Usage C: Subscribe / Broadcast

One-to-many fire-and-forget messaging. Any process can subscribe to an event name, and any process can broadcast to it. **The broadcaster will NOT receive its own message.**

### Main Process — Subscribe

```ts
import { xpcMain } from 'electron-xpc/main';

xpcMain.subscribe('dataUpdated', (payload) => {
  console.log('[main] dataUpdated received:', payload.params);
});
```

### Renderer / Preload — Subscribe

```ts
import { xpcRenderer } from 'electron-xpc/renderer'; // or 'electron-xpc/preload'

xpcRenderer.subscribe('dataUpdated', (payload) => {
  console.log('[renderer] dataUpdated received:', payload.params);
});
```

### Renderer / Preload — Broadcast

```ts
import { xpcRenderer } from 'electron-xpc/renderer'; // or 'electron-xpc/preload'

// All subscribers in other processes will receive this; the sender will not.
xpcRenderer.broadcast('dataUpdated', { source: 'user-action' });
```

### Main Process — Broadcast

```ts
import { xpcMain } from 'electron-xpc/main';

xpcMain.broadcast('dataUpdated', { source: 'background-sync' });
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

## License

MIT
