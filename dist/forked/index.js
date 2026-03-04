'use strict';

var semaphore = require('@rig-lib/semaphore');

// src/main/xpcId.helper.ts
var prefix = Math.random().toString(36).slice(2, 8);
var counter = 0;
var generateXpcId = () => {
  return `${prefix}-${(++counter).toString(36)}`;
};
var XpcForkTask = class {
  constructor(payload) {
    this.id = payload.id;
    this.handleName = payload.handleName;
    this.params = payload.params;
    this.ret = payload.ret ?? null;
    this.semaphore = new semaphore.Semaphore(1);
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

// src/forked/xpcForkedChild.helper.ts
var FORK_FINISH = "__fork_finish__";
var XpcForkedChild = class {
  constructor() {
    this.pendingTasks = /* @__PURE__ */ new Map();
    this.setupListeners();
  }
  /**
   * Invoke a handle registered in the parent process.
   * Blocks until the parent responds via __fork_finish__.
   */
  async invoke(handleName, payload) {
    const id = generateXpcId();
    const task = new XpcForkTask({ id, handleName, params: payload });
    this.pendingTasks.set(id, task);
    const message = {
      id,
      handleName,
      params: payload
    };
    process.send(message, void 0, {}, (err) => {
      if (err) {
        console.error(`[XpcForkedChild] Failed to send for "${handleName}":`, err);
        const t = this.pendingTasks.get(id);
        if (t) {
          t.unblock();
        }
      }
    });
    await task.block();
    this.pendingTasks.delete(id);
    return task.ret;
  }
  setupListeners() {
    process.on("message", (message) => {
      if (!message || message.__fork_event__ !== FORK_FINISH) return;
      const payload = message.payload;
      const task = this.pendingTasks.get(payload.id);
      if (task) {
        task.ret = payload.ret ?? null;
        task.unblock();
      }
    });
  }
};

exports.XpcForkTask = XpcForkTask;
exports.XpcForkedChild = XpcForkedChild;
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map