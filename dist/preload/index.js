'use strict';

var electron = require('electron');

// src/preload/xpcPreload.helper.ts

// src/preload/xpcId.helper.ts
var prefix = Math.random().toString(36).slice(2, 8);
var counter = 0;
var generateXpcId = () => {
  return `r-${prefix}-${(++counter).toString(36)}`;
};

// src/preload/xpcPreload.helper.ts
var XPC_REGISTER = "__xpc_register__";
var XPC_EXEC = "__xpc_exec__";
var XPC_FINISH = "__xpc_finish__";
var xpcHandlers = /* @__PURE__ */ new Map();
var handle = (handleName, handler) => {
  if (xpcHandlers.has(handleName)) {
    electron.ipcRenderer.removeAllListeners(handleName);
  }
  xpcHandlers.set(handleName, handler);
  electron.ipcRenderer.send(XPC_REGISTER, { handleName });
  electron.ipcRenderer.on(handleName, async (_event, payload) => {
    let ret = null;
    const localHandler = xpcHandlers.get(handleName);
    if (localHandler) {
      try {
        ret = await localHandler(payload);
      } catch (_e) {
        ret = null;
      }
    }
    electron.ipcRenderer.send(XPC_FINISH, {
      id: payload.id,
      handleName: payload.handleName,
      params: payload.params,
      ret
    });
  });
};
var removeHandle = (handleName) => {
  xpcHandlers.delete(handleName);
  electron.ipcRenderer.removeAllListeners(handleName);
};
var send = async (handleName, params) => {
  const payload = {
    id: generateXpcId(),
    handleName,
    params,
    ret: null
  };
  return await electron.ipcRenderer.invoke(XPC_EXEC, payload);
};
var createXpcRendererApi = () => {
  return {
    handle: (handleName, handler) => {
      handle(handleName, handler);
    },
    removeHandle: (handleName) => {
      removeHandle(handleName);
    },
    send: (handleName, params) => {
      return send(handleName, params);
    }
  };
};
var xpcRenderer = createXpcRendererApi();
if (process.contextIsolated) {
  try {
    electron.contextBridge.exposeInMainWorld("xpcRenderer", xpcRenderer);
  } catch (error) {
    console.error("[xpcPreload] exposeInMainWorld failed:", error);
  }
} else {
  globalThis.xpcRenderer = xpcRenderer;
}

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
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (descriptor && typeof descriptor.value === "function") {
      names.push(key);
    }
  }
  return names;
};

// src/preload/xpcPreload.handler.ts
var XpcPreloadHandler = class {
  constructor() {
    const className = this.constructor.name;
    const methodNames = getHandlerMethodNames(Object.getPrototypeOf(this));
    for (const methodName of methodNames) {
      const channel = buildXpcChannel(className, methodName);
      const method = this[methodName].bind(this);
      xpcRenderer.handle(channel, async (payload) => {
        return await method(payload.params);
      });
    }
  }
};

// src/preload/xpcPreload.emitter.ts
var createXpcPreloadEmitter = (className) => {
  return new Proxy({}, {
    get(_target, prop) {
      const channel = buildXpcChannel(className, prop);
      return (params) => xpcRenderer.send(channel, params);
    }
  });
};

exports.XpcPreloadHandler = XpcPreloadHandler;
exports.createXpcPreloadEmitter = createXpcPreloadEmitter;
exports.xpcHandlers = xpcHandlers;
exports.xpcRenderer = xpcRenderer;
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map