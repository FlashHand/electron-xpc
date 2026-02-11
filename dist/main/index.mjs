import { ipcMain, webContents } from 'electron';
import { Semaphore } from 'rig-foundation';

// main/xpc-center.helper.ts
var XpcTask = class {
  constructor(payload) {
    this.id = payload.id;
    this.handleName = payload.handleName;
    this.params = payload.params;
    this.ret = payload.ret ?? null;
    this.semaphore = new Semaphore(1);
    this.semaphore.take(() => {
    });
  }
  /** Block until unblock() is called */
  block() {
    return this.semaphore.takeAsync();
  }
  /** Release the semaphore, unblocking the waiting block() call */
  unblock() {
    this.semaphore.leave();
  }
  /** Convert to a plain XpcPayload (serializable for IPC) */
  toPayload() {
    return {
      id: this.id,
      handleName: this.handleName,
      params: this.params,
      ret: this.ret
    };
  }
};

// main/xpc-center.helper.ts
var XPC_REGISTER = "__xpc_register__";
var XPC_EXEC = "__xpc_exec__";
var XPC_FINISH = "__xpc_finish__";
var XpcCenter = class {
  constructor() {
    /** handleName → webContentsId */
    this.registry = /* @__PURE__ */ new Map();
    /** task.id → XpcTask (with semaphore block/unblock) */
    this.pendingTasks = /* @__PURE__ */ new Map();
    this.setupListeners();
  }
  setupListeners() {
    ipcMain.on(XPC_REGISTER, (event, payload) => {
      this.registry.set(payload.handleName, event.sender.id);
    });
    ipcMain.handle(XPC_EXEC, async (_event, payload) => {
      const targetId = this.registry.get(payload.handleName);
      if (targetId == null) {
        return null;
      }
      const target = webContents.fromId(targetId);
      if (!target) {
        return null;
      }
      const task = new XpcTask(payload);
      this.pendingTasks.set(task.id, task);
      target.send(payload.handleName, payload);
      await task.block();
      this.pendingTasks.delete(task.id);
      return task.toPayload().ret ?? null;
    });
    ipcMain.on(XPC_FINISH, (_event, payload) => {
      const task = this.pendingTasks.get(payload.id);
      if (task) {
        task.ret = payload.ret ?? null;
        task.unblock();
      }
    });
  }
};
var xpcCenter = new XpcCenter();

// main/xpc-id.helper.ts
var prefix = Math.random().toString(36).slice(2, 8);
var counter = 0;
var generateXpcId = () => {
  return `${prefix}-${(++counter).toString(36)}`;
};

// main/xpc-main.helper.ts
var XPC_FINISH2 = "__xpc_finish__";
var XpcMain = class {
  constructor() {
    this.pendingTasks = /* @__PURE__ */ new Map();
    this.setupFinishListener();
  }
  setupFinishListener() {
    ipcMain.on(XPC_FINISH2, (_event, payload) => {
      const task = this.pendingTasks.get(payload.id);
      if (task) {
        task.ret = payload.ret ?? null;
        task.unblock();
      }
    });
  }
  /**
   * Send a message to a specific renderer window and await the response.
   * The target renderer must have registered the handleName via xpcRenderer.handle().
   */
  async sendToRenderer(win, handleName, params) {
    const task = new XpcTask({
      id: generateXpcId(),
      handleName,
      params
    });
    this.pendingTasks.set(task.id, task);
    win.webContents.send(handleName, task.toPayload());
    await task.block();
    this.pendingTasks.delete(task.id);
    return task.toPayload().ret ?? null;
  }
};
var xpcMain = new XpcMain();

export { XpcTask, xpcCenter, xpcMain };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map