import { MessageChannelMain, utilityProcess, webContents, ipcMain } from 'electron';
import { Semaphore } from '@rig-lib/semaphore';
import { randomUUID } from 'crypto';

// src/main/xpcCenter.helper.ts
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

// src/main/xpcId.helper.ts
var prefix = Math.random().toString(36).slice(2, 8);
var counter = 0;
var generateXpcId = () => {
  return `${prefix}-${(++counter).toString(36)}`;
};
var XPC_REGISTER = "__xpc_register__";
var XPC_FINISH = "__xpc_finish__";
var XpcMain = class {
  constructor() {
    this.handlers = /* @__PURE__ */ new Map();
  }
  /**
   * Register a handler in the main process.
   * When another renderer calls send() with this handleName, xpcCenter will
   * invoke this handler directly (webContentsId = 0) without forwarding to a renderer.
   */
  handle(handleName, handler) {
    this.handlers.set(handleName, handler);
    xpcCenter.registerMainHandler(handleName);
  }
  /**
   * Get the registered handler for a given handleName.
   */
  getHandler(handleName) {
    return this.handlers.get(handleName);
  }
  /**
   * Send a message to a registered handler by handleName.
   * Delegates to xpcCenter.exec() which handles both main-process and renderer targets.
   */
  async send(handleName, params) {
    return xpcCenter.exec(handleName, params);
  }
};
var xpcMain = new XpcMain();
function createUtilityProcess(options) {
  const { modulePath, args, env, execArgv, serviceName } = options;
  const { port1, port2 } = new MessageChannelMain();
  const forkOptions = {
    stdio: "pipe"
  };
  if (env !== void 0) {
    forkOptions.env = env;
  }
  if (execArgv !== void 0) {
    forkOptions.execArgv = execArgv;
  }
  if (serviceName !== void 0) {
    forkOptions.serviceName = serviceName;
  }
  const child = utilityProcess.fork(modulePath, args, forkOptions);
  child.postMessage({ type: "xpc:init" }, [port1]);
  port2.on("message", async (event) => {
    const message = event.data;
    const { type, payload, handleName } = message;
    if (type === XPC_REGISTER) {
      console.log(`[xpcMain] Utility process registered handler: ${handleName}`);
      xpcCenter.registerPortHandler(handleName, port2);
    }
    if (type === XPC_FINISH && payload) {
      xpcCenter.handleUtilityFinish(payload);
    }
  });
  port2.start();
  const kill = () => {
    port2.close();
    return child.kill();
  };
  return {
    child,
    kill
  };
}
var XPC_REGISTER2 = "__xpc_register__";
var XPC_EXEC = "__xpc_exec__";
var XPC_FINISH2 = "__xpc_finish__";
var XpcCenter = class {
  constructor() {
    /** handleName → RegistryEntry */
    this.registry = /* @__PURE__ */ new Map();
    /** port_id → MessagePortMain */
    this.port2Map = /* @__PURE__ */ new Map();
    /** task.id → XpcTask (with semaphore block/unblock) */
    this.pendingTasks = /* @__PURE__ */ new Map();
  }
  init() {
    this.setupListeners();
  }
  /**
   * Register a main-process handleName in the registry with webContentsId = 0.
   */
  registerMainHandler(handleName) {
    this.registry.set(handleName, { type: "renderer", id: 0 });
  }
  /**
   * Register a utility process port handler.
   * @param handleName - The handler name
   * @param port2 - The MessagePort for communication
   * @returns The generated port_id
   */
  registerPortHandler(handleName, port2) {
    const portId = randomUUID();
    this.registry.set(handleName, { type: "port", id: portId });
    this.port2Map.set(portId, port2);
    return portId;
  }
  /**
   * Handle finish message from utility process.
   * Called by xpcMain when utility process sends XPC_FINISH.
   */
  handleUtilityFinish(payload) {
    const task = this.pendingTasks.get(payload.id);
    if (task) {
      task.ret = payload.ret ?? null;
      task.unblock();
    }
  }
  /**
   * Execute a handleName: if main-process handler, call directly;
   * otherwise forward to target renderer or utility process, block until __xpc_finish__.
   * Used by both ipcMain.handle(XPC_EXEC) and xpcMain.send().
   */
  async exec(handleName, params) {
    const entry = this.registry.get(handleName);
    if (entry == null) {
      return null;
    }
    const payload = {
      id: generateXpcId(),
      handleName,
      params
    };
    if (entry.type === "renderer" && entry.id === 0) {
      const handler = xpcMain.getHandler(handleName);
      if (!handler) {
        return null;
      }
      try {
        return await handler(payload);
      } catch (_e) {
        return null;
      }
    }
    if (entry.type === "port") {
      const port2 = this.port2Map.get(entry.id);
      if (!port2) {
        return null;
      }
      const task2 = new XpcTask(payload);
      this.pendingTasks.set(task2.id, task2);
      port2.postMessage({
        type: "exec",
        handleName,
        payload
      });
      await task2.block();
      this.pendingTasks.delete(task2.id);
      return task2.toPayload().ret ?? null;
    }
    const target = webContents.fromId(entry.id);
    if (!target || target.isDestroyed() || target.isCrashed()) {
      return null;
    }
    const task = new XpcTask(payload);
    this.pendingTasks.set(task.id, task);
    target.send(handleName, payload);
    await task.block();
    this.pendingTasks.delete(task.id);
    return task.toPayload().ret ?? null;
  }
  setupListeners() {
    ipcMain.on(XPC_REGISTER2, (event, payload) => {
      const existing = this.registry.get(payload.handleName);
      if (existing != null && !(existing.type === "renderer" && existing.id === event.sender.id)) {
        console.log(`[xpcCenter] handler "${payload.handleName}" overwritten: ${existing.type}:${existing.id} \u2192 renderer:${event.sender.id}`);
      }
      this.registry.set(payload.handleName, { type: "renderer", id: event.sender.id });
    });
    ipcMain.handle(XPC_EXEC, async (_event, payload) => {
      return this.exec(payload.handleName, payload.params);
    });
    ipcMain.on(XPC_FINISH2, (_event, payload) => {
      const task = this.pendingTasks.get(payload.id);
      if (task) {
        task.ret = payload.ret ?? null;
        task.unblock();
      }
    });
  }
};
var xpcCenter = new XpcCenter();

// src/shared/xpc.decorator.ts
var XPC_IGNORE = /* @__PURE__ */ Symbol("xpc:ignore");
var xpcIgnore = (target, propertyKey) => {
  const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
  if (descriptor && typeof descriptor.value === "function") {
    descriptor.value[XPC_IGNORE] = true;
  }
};

// src/shared/xpcHandler.type.ts
var XPC_HANDLER_PREFIX = "xpc:";
var buildXpcChannel = (className, methodName) => {
  return `${XPC_HANDLER_PREFIX}${className}/${methodName}`;
};
var getHandlerMethodNames = (prototype) => {
  const names = [];
  const keys = Object.getOwnPropertyNames(prototype);
  for (const key of keys) {
    if (key === "constructor") continue;
    if (key.startsWith("_") || key.startsWith("$")) continue;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (descriptor && typeof descriptor.value === "function") {
      if (descriptor.value[XPC_IGNORE]) continue;
      names.push(key);
    }
  }
  return names;
};

// src/main/xpcMain.handler.ts
var XpcMainHandler = class {
  constructor() {
    const className = this.constructor.name;
    const methodNames = getHandlerMethodNames(Object.getPrototypeOf(this));
    for (const methodName of methodNames) {
      const channel = buildXpcChannel(className, methodName);
      const method = this[methodName].bind(this);
      xpcMain.handle(channel, async (payload) => {
        return await method(payload.params);
      });
    }
  }
};

// src/main/xpcMain.emitter.ts
var createXpcMainEmitter = (className) => {
  return new Proxy({}, {
    get(_target, prop) {
      const channel = buildXpcChannel(className, prop);
      return (params) => xpcMain.send(channel, params);
    }
  });
};

export { XpcMainHandler, XpcTask, createUtilityProcess, createXpcMainEmitter, xpcCenter, xpcIgnore, xpcMain };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map