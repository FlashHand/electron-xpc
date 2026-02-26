'use strict';

// src/renderer/xpcRenderer.helper.ts
var xpcRenderer = globalThis.xpcRenderer;

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

// src/renderer/xpcRenderer.handler.ts
var XpcRendererHandler = class {
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

// src/renderer/xpcRenderer.emitter.ts
var createXpcRendererEmitter = (className) => {
  return new Proxy({}, {
    get(_target, prop) {
      const channel = buildXpcChannel(className, prop);
      return (params) => xpcRenderer.send(channel, params);
    }
  });
};

exports.XpcRendererHandler = XpcRendererHandler;
exports.createXpcRendererEmitter = createXpcRendererEmitter;
exports.xpcIgnore = xpcIgnore;
exports.xpcRenderer = xpcRenderer;
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map