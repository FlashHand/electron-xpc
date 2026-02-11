import { ipcRenderer } from 'electron';

// preload/xpc-renderer.helper.ts

// preload/xpc-id.helper.ts
var prefix = Math.random().toString(36).slice(2, 8);
var counter = 0;
var generateXpcId = () => {
  return `r-${prefix}-${(++counter).toString(36)}`;
};

// preload/xpc-renderer.helper.ts
var XPC_REGISTER = "__xpc_register__";
var XPC_EXEC = "__xpc_exec__";
var XPC_FINISH = "__xpc_finish__";
var XpcRenderer = class {
  constructor() {
    this.handlers = /* @__PURE__ */ new Map();
  }
  /**
   * Register a handleName with the main process and bind a local async handler.
   * When another renderer calls send() with this handleName, xpcCenter will forward
   * the payload to this renderer, the handler executes, and result is sent back via __xpc_finish__.
   */
  handle(handleName, handler) {
    this.handlers.set(handleName, handler);
    ipcRenderer.send(XPC_REGISTER, { handleName });
    ipcRenderer.on(handleName, async (_event, payload) => {
      let ret = null;
      const localHandler = this.handlers.get(handleName);
      if (localHandler) {
        try {
          ret = await localHandler(payload);
        } catch (_e) {
          ret = null;
        }
      }
      ipcRenderer.send(XPC_FINISH, {
        id: payload.id,
        handleName: payload.handleName,
        params: payload.params,
        ret
      });
    });
  }
  /**
   * Remove a registered handler.
   */
  removeHandle(handleName) {
    this.handlers.delete(handleName);
    ipcRenderer.removeAllListeners(handleName);
  }
  /**
   * Send a message to another renderer (or any registered handler) via main process.
   * Uses ipcRenderer.invoke(__xpc_exec__) which blocks until the target finishes.
   * Returns the ret value from the target handler, or null.
   */
  async send(handleName, params) {
    const payload = {
      id: generateXpcId(),
      handleName,
      params,
      ret: null
    };
    return await ipcRenderer.invoke(XPC_EXEC, payload);
  }
};
var xpcRenderer = new XpcRenderer();
var exposeXpcRenderer = () => {
  return {
    handle: (handleName, handler) => {
      xpcRenderer.handle(handleName, handler);
    },
    removeHandle: (handleName) => {
      xpcRenderer.removeHandle(handleName);
    },
    send: (handleName, params) => {
      return xpcRenderer.send(handleName, params);
    }
  };
};

export { exposeXpcRenderer, xpcRenderer };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map