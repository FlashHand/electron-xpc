# electron-xpc

**Async/Await** 语法风格的跨进程通信库，基于信号量控制的方式开发。

不同于 Electron 内置的 `ipcRenderer.invoke` / `ipcMain.handle` 仅支持渲染进程到主进程的请求-响应模式，XPC 允许**任意进程**（渲染进程、主进程或工具进程）以完整的 `async/await` 语义调用**任意其他进程**中注册的handler——包括 `renderer <-> renderer`、`main <-> renderer` 以及 `utility <-> 任意进程` 的调用。

## 安装

```bash
yarn add electron-xpc
# 或
npm install electron-xpc
```

## 特性

1. **将工作分配到渲染进程** — 可以将耗时或阻塞性任务委托到渲染进程中执行，保持主进程的响应性，降低主进程的性能开销。
2. **任意进程间统一的 async/await 语义** — 由于所有跨进程调用均支持 `async/await`，跨多个进程的复杂多步作业流程可以用简洁的顺序逻辑编排，无需深层嵌套回调或手动事件协调。

## 进程层级说明

XPC 将 Electron 应用中的进程分为四个层级：

| 层级 | 运行环境 | 导入路径 |
|------|----------|----------|
| **Main Layer（主进程层）** | Node.js 主进程 | `electron-xpc/main` |
| **Preload Layer（预加载层）** | 渲染进程的 preload 脚本（可访问 `electron`） | `electron-xpc/preload` |
| **Web Layer（网页层）** | 渲染进程的网页（无 `electron` 访问，通过 `window.xpcRenderer`） | `electron-xpc/renderer` |
| **Utility Process Layer（工具进程层）** | 沙箱化的 Node.js 子进程 | `electron-xpc/utilityProcess` |

虽然preload属于渲染层,但是由于Preload包含了isolated nodejs context,所以架构上做了区分

---

## 用法 A：硬编码 send / handle

这是底层 API，需要手动指定通道名称字符串。

### 1. 在主进程初始化 XPC Center(必须)

```ts
// src/main/index.ts
import { xpcCenter } from 'electron-xpc/main';

xpcCenter.init();
```

### 2. Main Layer 中注册与发送

```ts
import { xpcMain } from 'electron-xpc/main';

// 注册handler
xpcMain.handle('my/mainChannel', async (payload) => {
  console.log('主进程收到:', payload.params);
  return { message: '来自主进程的问候' };
});

// 发送到任意已注册的handler（主进程或渲染进程）
const result = await xpcMain.send('my/channel', { foo: 'bar' });
```

### 3. Preload Layer 中注册与发送

```ts
// Preload 脚本 — 可直接访问 electron
import { xpcRenderer } from 'electron-xpc/preload';

// 注册handler
xpcRenderer.handle('my/channel', async (payload) => {
  console.log('收到参数:', payload.params);
  return { message: '来自 preload 的问候' };
});

// 发送到其他handler
const result = await xpcRenderer.send('other/channel', { foo: 'bar' });
```

### 4. Web Layer 中注册与发送

```ts
// 网页 — 无 electron 访问，使用 window.xpcRenderer
import { xpcRenderer } from 'electron-xpc/renderer';

// 注册handler
xpcRenderer.handle('my/webChannel', async (payload) => {
  return { message: '来自网页的问候' };
});

// 发送到其他handler
const result = await xpcRenderer.send('my/channel', { foo: 'bar' });
```

### 5. 移除handler

```ts
xpcRenderer.removeHandle('my/channel');
```

---

## 用法 B：Handler / Emitter 模式（推荐）

Handler/Emitter 模式提供**类型安全**、**自动注册**的通道，基于类名和方法名自动生成通道名称，无需硬编码字符串。

通道命名规则：`xpc:类名/方法名`

> **⚠️ 重要提示：Handler 方法最多只能接受 1 个参数。** 由于 `send()` 只能携带一个 `params` 值，不支持多参数方法。类型系统会强制执行此约束——拥有 2 个及以上参数的方法在 Emitter 类型中会被映射为 `never`，导致编译错误。

### Main Layer

```ts
import { XpcMainHandler, createXpcMainEmitter } from 'electron-xpc/main';

// --- 定义 Handler ---
class UserService extends XpcMainHandler {
  // ✅ 0 个参数 — 合法
  async getCount(): Promise<number> {
    return 42;
  }

  // ✅ 1 个参数 — 合法
  async getUserList(params: { page: number }): Promise<any[]> {
    return db.query('SELECT * FROM users LIMIT ?', [params.page]);
  }

  // ❌ 2+ 个参数 — 在 Emitter 侧会产生编译错误
  // async search(keyword: string, page: number): Promise<any> { ... }
}

// 实例化 — 自动注册：
//   xpc:UserService/getCount
//   xpc:UserService/getUserList
const userService = new UserService();
```

```ts
// --- 使用 Emitter（可在任意层级使用）---
import { createXpcMainEmitter } from 'electron-xpc/main';
import type { UserService } from './somewhere';

const userEmitter = createXpcMainEmitter<UserService>('UserService');

const count = await userEmitter.getCount();           // 发送到 xpc:UserService/getCount
const list = await userEmitter.getUserList({ page: 1 }); // 发送到 xpc:UserService/getUserList
```

### Preload Layer

```ts
import { XpcPreloadHandler, createXpcPreloadEmitter } from 'electron-xpc/preload';

// --- 定义 Handler ---
class MessageTable extends XpcPreloadHandler {
  async getMessageList(params: { chatId: string }): Promise<any[]> {
    return sqlite.query('SELECT * FROM messages WHERE chatId = ?', [params.chatId]);
  }
}

// 实例化 — 自动注册：xpc:MessageTable/getMessageList
const messageTable = new MessageTable();
```

```ts
// --- 使用 Emitter（可在其他 preload 或 web 层级使用）---
import { createXpcPreloadEmitter } from 'electron-xpc/preload';
import type { MessageTable } from './somewhere';

const messageEmitter = createXpcPreloadEmitter<MessageTable>('MessageTable');
const messages = await messageEmitter.getMessageList({ chatId: '123' });
```

### Web Layer

```ts
import { XpcRendererHandler, createXpcRendererEmitter } from 'electron-xpc/renderer';

// --- 定义 Handler ---
class UINotification extends XpcRendererHandler {
  async showToast(params: { text: string }): Promise<void> {
    toast.show(params.text);
  }
}

const uiNotification = new UINotification();
```

```ts
// --- 使用 Emitter（可在其他层级使用）---
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { UINotification } from './somewhere';

const notifyEmitter = createXpcRendererEmitter<UINotification>('UINotification');
await notifyEmitter.showToast({ text: 'Hello!' });
```

---

## 广播与订阅

即发即忘（fire-and-forget）的一对多通知，用于事件驱动的通信。

### 关键规则

1. **发送方不会收到自己发出的广播**
2. **订阅回调收到的是 `payload.params`，而不是直接的 params**

### 主进程

```ts
import { xpcMain } from 'electron-xpc/main';

// 广播给所有渲染进程窗口 + 所有已订阅的工具进程（主进程自己不会收到）
xpcMain.broadcast('language/changed', { lang: 'en' });

// 订阅其他进程的广播
xpcMain.subscribe('language/changed', (payload) => {
  const { lang } = payload.params;  // 通过 payload.params 取值
  console.log('Language:', lang);
});
```

### 渲染进程

```ts
import { xpcRenderer } from 'electron-xpc/renderer';

// 广播给其他所有渲染进程 + 主进程 + 所有已订阅的工具进程（发送方自己不会收到）
xpcRenderer.broadcast('language/changed', { lang: 'zh' });

xpcRenderer.subscribe('language/changed', (payload) => {
  const { lang } = payload.params;
  console.log('Language:', lang);
});
```

### 工具进程

```ts
import { xpcUtilityProcess } from 'electron-xpc/utilityProcess';

// 广播给主进程 + 所有渲染进程 + 其他所有工具进程（发送方自己不会收到）
xpcUtilityProcess.broadcast('language/changed', { lang: 'ja' });

xpcUtilityProcess.subscribe('language/changed', (payload) => {
  const { lang } = payload.params;
  console.log('Language:', lang);
});
```

工具进程不需要注册任何 handler 也能参与广播 —— 一个只负责监听或只负责通知的进程，
同样可以使用 `subscribe()` 和 `broadcast()`。

### 接收方对照表

| 发送方 | API | 接收方 |
|---|---|---|
| 主进程 | `xpcMain.broadcast(event, params)` | 所有渲染进程窗口 + 所有已订阅的工具进程（不含主进程自己） |
| 渲染进程 | `xpcRenderer.broadcast(event, params)` | 其他所有渲染进程 + 主进程 + 所有已订阅的工具进程（不含发送方） |
| 工具进程 | `xpcUtilityProcess.broadcast(event, params)` | 主进程 + 所有渲染进程 + 其他所有工具进程（不含发送方） |

每一行里发送方都被排除在自己的广播之外，工具进程这一行也不例外：一个进程即使同时
broadcast 和 subscribe 同一个事件，也不会收到自己发的那一条。

---

## Utility Process（工具进程）

Electron 的 [Utility Process](https://www.electronjs.org/docs/latest/api/utility-process) 运行在沙箱化的 Node.js 环境中，适合 CPU 密集或 I/O 密集的工作。`electron-xpc` 把工具进程接入了同一套 XPC 通信网络 —— 任意渲染进程或主进程都可以用同样的 `send()` API 调用工具进程里注册的 handler。

### 工具进程涉及的层级

| 层级 | 导入路径 |
|------|----------|
| **主进程**（创建与管理） | `electron-xpc/main` |
| **工具进程**（handle 与 send） | `electron-xpc/utilityProcess` |

---

### 完整最小示例

两个文件，此外无需任何东西 —— 工具进程里没有 init 调用、不用手动处理 `MessagePort`、不碰 `parentPort`。

```ts
// ── main.ts ─────────────────────────────────────────────────────
import { app } from 'electron';
import { xpcCenter, createUtilityProcess, xpcMain } from 'electron-xpc/main';
import * as path from 'path';

app.whenReady().then(async () => {
  xpcCenter.init();                                        // 每个 app 一次

  createUtilityProcess({                                   // 每个工具进程一次
    modulePath: path.join(__dirname, 'worker.js'),
    serviceName: 'my-worker',
  });

  // 主进程 → 工具进程
  const sum = await xpcMain.send('worker/add', { a: 1, b: 2 });   // 3

  // 主进程 → 所有订阅者（含工具进程）
  xpcMain.broadcast('app/theme', { dark: true });
});
```

```ts
// ── worker.ts（工具进程）─────────────────────────────────────────
import { xpcUtilityProcess } from 'electron-xpc/utilityProcess';

// 主进程、任意渲染进程、任意其他工具进程都能调用
xpcUtilityProcess.handle('worker/add', async ({ params }) => params.a + params.b);

xpcUtilityProcess.subscribe('app/theme', ({ params }) => {
  console.log('[worker] theme:', params.dark);
});

// 工具进程 → 任意进程
const answer = await xpcUtilityProcess.send('renderer/ask', { q: 'ready?' });
```

工具进程是靠**导入这个模块**接入 XPC 的 —— 导入的副作用会装上一个 `process.parentPort` 监听器，
等待 `createUtilityProcess()` 送来的端口。没有任何函数需要调用。
因此 `handle()` 和 `subscribe()` 可以写在模块顶层、早于端口到达，它们会排队并在就绪后重放；
`send()` 和 `broadcast()` 不行 —— 见[错误语义](#错误语义)。

---

### 第 1 步：在主进程中创建工具进程

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

  // 可选：把 stdout/stderr 接出来，才能看到工具进程里的 console.log
  worker.child.stdout?.on('data', (data) => console.log('[worker]', data.toString()));
  worker.child.stderr?.on('data', (data) => console.error('[worker]', data.toString()));
});
```

> **要用 `createUtilityProcess()`，不要用 Electron 原生的 `utilityProcess.fork()`。** 原生 fork 出来的子进程
> 是一个合法的工具进程，但**不是 XPC 对等端**：`send()` 它的 handler 会 resolve 成 `null`，它也收不到任何广播。
> 原因是结构性的 —— 通道的主进程那一端只有持有 `child` 句柄的人能接，而 Electron 不会发出「工具进程已创建」
> 事件供库来挂钩（它只有 `child-process-gone`，没有创建侧的对应事件）。所以接入 XPC 只能发生在创建的那一刻，
> 这个函数就是那一刻。

#### 选项

`UtilityProcessOptions` 继承 Electron 的 [`ForkOptions`](https://www.electronjs.org/docs/latest/api/utility-process#utilityprocessforkmodulepath-args-options)
—— Electron 接受的选项这里全都接受，并原样转发。

| 选项 | 类型 | 说明 |
|---|---|---|
| `modulePath` | `string` | **必填。** 工具进程要运行的脚本 |
| `args` | `string[]` | 作为 `process.argv` 传给子进程 |
| `stdio` | `'pipe' \| 'ignore' \| 'inherit' \| Array` | **默认 `'pipe'`**，因此 `child.stdout` / `child.stderr` 可读。可以自己传值覆盖 —— `'inherit'` 会把输出直接送到终端，但 `child.stdout` 会是 `null` |
| `env`、`execArgv`、`cwd`、`serviceName`、`session`、`partition`、… | 见 Electron 文档 | 原样转发 |

`serviceName` 值得设：它就是活动监视器 / 任务管理器以及 `app.getAppMetrics()` 里显示的名字。

返回 `{ child, kill }`。优先用返回的 `kill()` 而不是 `child.kill()` —— 它会**先**注销该进程的路由再关闭端口，
在途调用因此立即结算，而不必等 `exit` 事件。

---

### 第 2 步：在工具进程中注册 handler

通过 `xpcUtilityProcess.handle()` 注册的 handler 会自动转发给主进程的 `xpcCenter`，随后任意层级（渲染进程、preload、主进程）都可以调用。

```ts
// src/utility/worker.ts
import { xpcUtilityProcess } from 'electron-xpc/utilityProcess';

// handler 可以在 MessagePort 就绪之前于顶层注册：
// 它们会被排队，端口就绪后自动重放。
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

### 第 3 步：从任意层级调用工具进程的 handler

注册完成后，任何进程都可以用同样的 `send()` API 调用：

**在渲染进程 / Preload 中：**
```ts
import { xpcRenderer } from 'electron-xpc/preload'; // 或 'electron-xpc/renderer'

const result = await xpcRenderer.send('worker/processData', { input: 'hello' });
console.log(result); // { result: '...' }
```

**在主进程中：**
```ts
import { xpcMain } from 'electron-xpc/main';

const status = await xpcMain.send('worker/getStatus');
console.log(status); // { status: 'idle', uptime: 42 }
```

---

### 第 4 步：从工具进程发送给其他 handler

工具进程同样可以调用主进程或渲染进程中注册的 handler：

```ts
// src/utility/worker.ts
import { xpcUtilityProcess } from 'electron-xpc/utilityProcess';

xpcUtilityProcess.handle('worker/doSomething', async (payload) => {
  // 调用渲染进程或主进程中注册的 handler
  const rendererResult = await xpcUtilityProcess.send('renderer/hello', { from: 'worker' });
  console.log('[worker] renderer replied:', rendererResult);
  return { done: true };
});
```

**渲染进程一侧：**
```ts
import { xpcRenderer } from 'electron-xpc/preload';

xpcRenderer.handle('renderer/hello', async (payload) => {
  console.log('[renderer] called by worker with:', payload.params);
  return 'hello from renderer';
});
```

工具进程的 `send()` 可以抵达**任意**层级 —— 主进程、渲染进程、另一个工具进程，或者它自己注册的 handler。
应答按工具进程自己生成的 task id 匹配，因此并发调用不会串。

---

### 第 5 步：在工具进程中广播与订阅

```ts
// src/utility/worker.ts
import { xpcUtilityProcess } from 'electron-xpc/utilityProcess';

// 抵达主进程 + 所有渲染进程 + 其他所有工具进程，永远不含发送方自己
xpcUtilityProcess.broadcast('worker/progress', { done: 42, total: 100 });

xpcUtilityProcess.subscribe('app/shutdown', (payload) => {
  console.log('[worker] shutting down:', payload.params);
});
```

谁能收到哪一条，见上文[接收方对照表](#接收方对照表)。

---

### 生命周期

当一个工具进程退出时 —— 正常退出、被 `kill()`、或者崩溃 —— `xpcCenter` 会清掉属于它的一切：

| 退出时 | 结果 |
|---|---|
| 它注册过的 handler | 从 registry 中移除。之后再 `send()` 这些名字会走「无归属」路径，resolve 成 `null` |
| 它持有的订阅 | 移除。后续广播不再投递给它 |
| 正在飞向它的 `send()` | 立即以 `null` 结算，而不是等一个永远不会到来的应答 |
| 其他工具进程 | 不受影响 —— 清理严格限定在退出进程自己的端口范围内 |

清理是幂等的，因此 `kill()` 之后再触发 `'exit'` 事件是安全的。

---

### 错误语义

所有路由结果都是 resolve，而不是 throw。`send()` 在以下情况返回 `null`：handleName 没有归属、
归属进程已退出、或远端 handler 自己抛了异常 —— 调用方不需要为路由失败包 `try/catch`。

唯一的例外是在 **MessagePort 到达之前**调用 `xpcUtilityProcess.send()` 或 `.broadcast()`，
它会抛出 `MessagePort not initialized`。`handle()` 和 `subscribe()` 没有这个问题：它们会排队，
端口就绪后自动重放。因此，一个「第一个动作就是 broadcast」的工具进程（没有 handler、没有订阅）
必须重试到这个调用不再抛异常为止。目前还没有可以 await 的就绪信号。

---

### 通信流程（含工具进程）

```
渲染进程 / 主进程              主进程 (xpcCenter)              工具进程
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
      |                                |  [信号量阻塞]                 |  执行 handler
      |                                | <-- port1.postMessage(finish)-|
      |                                |  [信号量解除]                 |
      |  <---- 返回结果 -------------- |                               |
      |                                |                               |
      |                                |  xpcUtilityProcess.send(...)  |
      |                                | <-- __xpc_exec__ (port1) ---- |
      |  <---- forward(name) --------- |                               |
      |  执行 handler                  |                               |
      |  __xpc_finish__ ------------>  |                               |
      |                                |  ----> 返回结果 (port2) ----- |
```

---

## 架构

### 通信流程

```
Preload A / Web A               主进程                  Preload B / Web B
    |                              |                              |
    |  handle(name, handler) ----> |                              |
    |  __xpc_register__            |                              |
    |                              |   <---- send(name, params)   |
    |                              |         __xpc_exec__         |
    |   <---- forward(name) ----   |                              |
    |         执行 handler         |                              |
    |   ---- __xpc_finish__ ---->  |                              |
    |                              |   ----> 返回结果             |

主进程 (xpcMain)
    |                              |
    |  handle(name, handler)       |  -- 注册到 xpcCenter registry (id=0)
    |  send(name, params) -------> |  -- 委托给 xpcCenter.exec()
    |                              |     id=0: 直接调用本地 handler
    |                              |     否则: 转发到渲染进程，阻塞等待完成
```

---

## 1.2.0 变更

工具进程升级为完整的 XPC 对等端：它可以 `send()` 给主进程、渲染进程、其他工具进程以及它自己；
主进程与渲染进程也可以 `send()` 给它；三种发送方都能参与 `broadcast()` / `subscribe()`。
工具进程退出时，其路由与在途调用会被清理。

`UtilityProcessOptions` 现在继承 Electron 的 `ForkOptions`，因此 `cwd`、`session`、`partition` 等
选项会被转发而不再被静默丢弃；此前硬写死的 `stdio: 'pipe'` 变成可覆盖的默认值。

**内部签名变更。** `xpcCenter.registerPortHandler(handleName, port2)` 现为
`registerPortHandler(handleName, portId)`，并新增 `xpcCenter.registerPort(port)`。
`xpcCenter` 由 `electron-xpc/main` 导出，因此这两个方法虽然按设计属于内部实现，仍在此记录 ——
没有任何已文档化的消费方 API 发生变化。

---

## 参与开发

`yarn test:app` 会构建本包并启动 `test/` 下的手工 Electron 测试台，用十二个可点击按钮分别覆盖
十二种跨进程用例（工具进程出向、入向、广播自排除、生命周期）。

## 许可证

MIT
