// Issue: docs/issues/finish-echoes-params.md. A task result (`__xpc_finish__`) carries id, handleName and ret —
// never the request's params, which every receiver ignored and main had to decode again. Runs with plain Node
// against dist/ — `electron` is replaced by a stub, so no Electron app is launched. `yarn test:unit`.
import test from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// A request large enough that echoing it would be the dominant cost of the result message.
const BIG = { rows: Array.from({ length: 2000 }, (_, i) => ({ i, text: '会话内容 message body '.repeat(4) })) };
const assertResult = (payload, { id, handleName, ret }) => {
  assert.equal(payload.id, id);
  assert.equal(payload.handleName, handleName);
  assert.deepEqual(payload.ret, ret);
  assert.ok(!('params' in payload), `the result for ${handleName} must not echo the request params`);
};

// ── renderer / preload: a handler answers a forwarded call ──
test('preload: a handler result goes back with id, handleName and ret only', async () => {
  const listeners = new Map();
  const sent = [];
  const fakeElectron = {
    ipcRenderer: {
      on: (channel, listener) => listeners.set(channel, listener),
      send: (channel, payload) => sent.push({ channel, payload }),
      invoke: async () => null,
      removeAllListeners: (channel) => listeners.delete(channel)
    },
    contextBridge: { exposeInMainWorld: () => undefined }
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return fakeElectron;
    return originalLoad.call(this, request, parent, isMain);
  };
  let preload;
  try {
    preload = require('../dist/preload/index.js');
  } finally {
    Module._load = originalLoad;
  }

  preload.xpcRenderer.handle('Store/save', async (payload) => ({ ok: true, count: payload.params.rows.length }));
  // main forwards the call: webContents.send(handleName, payload)
  await listeners.get('Store/save')({}, { id: 'm-1', handleName: 'Store/save', params: BIG });

  const finish = sent.find((entry) => entry.channel === '__xpc_finish__');
  assert.ok(finish, 'the result was sent');
  assertResult(finish.payload, { id: 'm-1', handleName: 'Store/save', ret: { ok: true, count: 2000 } });
});

// ── utility process: a handler answers a call main forwarded to it ──
test('utility process: a handler result goes back with id, handleName and ret only', async () => {
  const { xpcUtilityProcess } = require('../dist/utilityProcess/index.js');
  const listeners = [];
  const sent = [];
  xpcUtilityProcess.init({
    on: (event, listener) => event === 'message' && listeners.push(listener),
    postMessage: (message) => sent.push(message),
    start: () => undefined
  });
  xpcUtilityProcess.handle('Worker/save', async (payload) => ({ ok: true, count: payload.params.rows.length }));
  await Promise.all(listeners.map((listener) => listener({ data: { type: 'exec', handleName: 'Worker/save', payload: { id: 'm-2', handleName: 'Worker/save', params: BIG } } })));

  const finish = sent.find((message) => message.type === '__xpc_finish__');
  assert.ok(finish, 'the result was sent');
  assertResult(finish.payload, { id: 'm-2', handleName: 'Worker/save', ret: { ok: true, count: 2000 } });
});

// ── main: answering a send() the utility process started ──
test('main: the result of a utility-initiated send() goes back with id, handleName and ret only', async () => {
  const utilityPorts = [];
  const fakeElectron = {
    ipcMain: { handle: () => undefined, on: () => undefined },
    webContents: { fromId: () => undefined },
    MessageChannelMain: class {
      constructor() {
        const listeners = [];
        const sent = [];
        this.port1 = {};
        this.port2 = {
          on: (event, listener) => event === 'message' && listeners.push(listener),
          postMessage: (message) => sent.push(message),
          start: () => undefined,
          close: () => undefined,
          deliver: (data) => Promise.all(listeners.map((listener) => listener({ data }))),
          sent
        };
        utilityPorts.push(this.port2);
      }
    },
    utilityProcess: { fork: () => ({ postMessage: () => undefined, on: () => undefined, kill: () => true }) }
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return fakeElectron;
    return originalLoad.call(this, request, parent, isMain);
  };
  let xpc;
  try {
    xpc = require('../dist/main/index.js');
  } finally {
    Module._load = originalLoad;
  }
  xpc.xpcCenter.init();
  xpc.xpcMain.handle('Main/save', async (payload) => ({ ok: true, count: payload.params.rows.length }));
  xpc.createUtilityProcess({ modulePath: '/dev/null' });
  const port = utilityPorts.at(-1);
  // The utility process asks main: port __xpc_exec__ with the id it minted.
  await port.deliver({ type: '__xpc_exec__', payload: { id: 'u-7', handleName: 'Main/save', params: BIG, ret: null } });

  const finish = port.sent.find((message) => message.type === '__xpc_finish__');
  assert.ok(finish, 'the result was sent');
  assertResult(finish.payload, { id: 'u-7', handleName: 'Main/save', ret: { ok: true, count: 2000 } });
});
