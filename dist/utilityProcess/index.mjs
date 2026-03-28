import { Semaphore } from '@rig-lib/semaphore';

// src/utilityProcess/xpcUtilityProcess.helper.ts

// src/utilityProcess/xpcId.helper.ts
var prefix = Math.random().toString(36).slice(2, 8);
var counter = 0;
var generateXpcId = () => {
  return `${prefix}-${(++counter).toString(36)}`;
};

// src/utilityProcess/xpcUtilityProcess.helper.ts
var XPC_REGISTER = "__xpc_register__";
var XPC_EXEC = "__xpc_exec__";
var XPC_FINISH = "__xpc_finish__";
var XpcUtilityProcess = class {
  constructor() {
    this.port = null;
    // Electron.MessagePort in utility process
    this.handlers = /* @__PURE__ */ new Map();
    this.pendingTasks = /* @__PURE__ */ new Map();
    this.pendingHandlers = [];
  }
  /**
   * Initialize with a MessagePort from the main process.
   * Must be called before using handle() or send().
   */
  init(port) {
    this.port = port;
    this.setupListeners();
    this.port.start();
    for (const { handleName, handler } of this.pendingHandlers) {
      this.registerHandler(handleName, handler);
    }
    this.pendingHandlers = [];
  }
  /**
   * Register a handler for incoming messages with the given handleName.
   * When main process sends a message to this handleName, the handler executes
   * and the result is sent back via __xpc_finish__.
   */
  handle(handleName, handler) {
    if (!this.port) {
      this.pendingHandlers.push({ handleName, handler });
      return;
    }
    this.registerHandler(handleName, handler);
  }
  registerHandler(handleName, handler) {
    if (this.handlers.has(handleName)) {
      this.handlers.delete(handleName);
    }
    this.handlers.set(handleName, handler);
    this.port?.postMessage({
      type: XPC_REGISTER,
      handleName
    });
  }
  /**
   * Remove a registered handler.
   */
  removeHandle(handleName) {
    this.handlers.delete(handleName);
  }
  /**
   * Send a message to main process (or another registered handler) via MessagePort.
   * Uses semaphore to block until the target finishes and returns the result.
   * Returns the ret value from the target handler, or null.
   */
  async send(handleName, params) {
    if (!this.port) {
      throw new Error("[xpcUtilityProcess] MessagePort not initialized. Call init() first.");
    }
    const payload = {
      id: generateXpcId(),
      handleName,
      params,
      ret: null
    };
    const semaphore = new Semaphore(1);
    semaphore.take(() => {
    });
    const taskInfo = { semaphore, ret: null };
    this.pendingTasks.set(payload.id, taskInfo);
    this.port.postMessage({
      type: XPC_EXEC,
      payload
    });
    await semaphore.takeAsync();
    const result = taskInfo.ret;
    this.pendingTasks.delete(payload.id);
    return result ?? null;
  }
  setupListeners() {
    if (!this.port) return;
    this.port.on("message", async (event) => {
      const { type, payload, handleName } = event.data;
      if (type === "exec" && handleName) {
        const handler = this.handlers.get(handleName);
        let ret = null;
        if (handler && payload) {
          try {
            ret = await handler(payload);
          } catch (_e) {
            ret = null;
          }
        }
        this.port?.postMessage({
          type: XPC_FINISH,
          payload: {
            id: payload.id,
            handleName: payload.handleName,
            params: payload.params,
            ret
          }
        });
      }
      if (type === XPC_FINISH && payload) {
        const taskInfo = this.pendingTasks.get(payload.id);
        if (taskInfo) {
          taskInfo.ret = payload.ret ?? null;
          taskInfo.semaphore.leave();
        }
      }
    });
  }
};
var xpcUtilityProcess = new XpcUtilityProcess();
if (typeof process !== "undefined" && process.parentPort) {
  process.parentPort.on("message", (event) => {
    if (event.data?.type === "xpc:init" && event.ports?.length > 0) {
      xpcUtilityProcess.init(event.ports[0]);
    }
  });
}

export { xpcUtilityProcess };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map