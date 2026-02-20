# electron-xpc

**Async/Await** 语法风格的跨进程通信库，基于信号量控制的方式开发。

不同于 Electron 内置的 `ipcRenderer.invoke` / `ipcMain.handle` 仅支持渲染进程到主进程的请求-响应模式，XPC 允许**任意进程**（渲染进程或主进程）以完整的 `async/await` 语义调用**任意其他进程**中注册的处理器——包括 `renderer <-> renderer` 和 `main <-> renderer` 的调用。

## 安装

```bash
yarn add electron-xpc
# 或
npm install electron-xpc
```

## 特性

1. **将工作分配到渲染进程** — 可以将耗时或阻塞性任务委托到渲染进程中执行，保持主进程的响应性，降低主进程的性能开销。
2. **任意进程间统一的 async/await 语义** — 由于所有跨进程调用均支持 `async/await`，跨多个进程的复杂多步作业流程可以用简洁的顺序逻辑编排，无需深层嵌套回调或手动事件协调。

## 用法 A：硬编码 send / handle

这是底层 API，需要手动指定通道名称字符串。

### 1. 初始化 XPC Center（Main Layer）

```ts
// src/main/index.ts
import { xpcCenter } from 'electron-xpc/main';

xpcCenter.init();
```

### 2. Main Layer 中注册与发送

```ts
import { xpcMain } from 'electron-xpc/main';

// 注册处理器
xpcMain.handle('my/mainChannel', async (payload) => {
  console.log('主进程收到:', payload.params);
  return { message: '来自主进程的问候' };
});

// 发送到任意已注册的处理器（主进程或渲染进程）
const result = await xpcMain.send('my/channel', { foo: 'bar' });
```

### 3. Preload Layer 中注册与发送

```ts
// Preload 脚本 — 可直接访问 electron
import { xpcRenderer } from 'electron-xpc/preload';

// 注册处理器
xpcRenderer.handle('my/channel', async (payload) => {
  console.log('收到参数:', payload.params);
  return { message: '来自 preload 的问候' };
});

// 发送到其他处理器
const result = await xpcRenderer.send('other/channel', { foo: 'bar' });
```

### 4. Web Layer 中注册与发送

```ts
// 网页 — 无 electron 访问，使用 window.xpcRenderer
import { xpcRenderer } from 'electron-xpc/renderer';

// 注册处理器
xpcRenderer.handle('my/webChannel', async (payload) => {
  return { message: '来自网页的问候' };
});

// 发送到其他处理器
const result = await xpcRenderer.send('my/channel', { foo: 'bar' });
```

### 5. 移除处理器

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

## 架构

### 进程层级说明

XPC 将 Electron 应用中的进程分为三个层级：

| 层级 | 运行环境 | 导入路径 |
|------|----------|----------|
| **Main Layer（主进程层）** | Node.js 主进程 | `electron-xpc/main` |
| **Preload Layer（预加载层）** | 渲染进程的 preload 脚本（可访问 `electron`） | `electron-xpc/preload` |
| **Web Layer（网页层）** | 渲染进程的网页（无 `electron` 访问，通过 `window.xpcRenderer`） | `electron-xpc/renderer` |

虽然preload属于渲染层,但是由于Preload包含了isolated nodejs context,所以架构上做了区分

---

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

## 许可证

MIT
