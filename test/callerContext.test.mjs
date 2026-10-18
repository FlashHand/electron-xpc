// Feature: docs/features/caller-context.md (R1–R5). Runs with plain Node against dist/ — Electron's main-process
// API is replaced by a stub, so no Electron app is launched. `yarn test:unit`.
import test from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// ── a stand-in for the parts of `electron` that dist/main touches ──
const ipcHandlers = new Map();
const ipcListeners = new Map();
const utilityPorts = [];
const fakeElectron = {
  ipcMain: {
    handle: (channel, handler) => ipcHandlers.set(channel, handler),
    on: (channel, listener) => ipcListeners.set(channel, listener)
  },
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
        // test helpers
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
const xpc = require('../dist/main/index.js');
Module._load = originalLoad;

xpc.xpcCenter.init();
// An invoke event as Electron builds it: processId / frameId are the sending frame's ids at send time.
const event = (sender, senderFrame) => ({ sender, senderFrame, processId: senderFrame?.processId ?? 0, frameId: senderFrame?.routingId ?? 0 });
const invoke = (sender, senderFrame, handleName, params) =>
  ipcHandlers.get('__xpc_exec__')(event(sender, senderFrame), { id: 'x', handleName, params });

const frame = (processId, routingId, url = 'http://localhost:5173/index.html') => ({ processId, routingId, url, origin: new URL(url).origin });
const contents = (id, mainFrame, destroyed = false) => ({ id, mainFrame, isDestroyed: () => destroyed });
const findSeen = (tag) => seen.find((item) => item.tag === tag);

// What a handler sees, captured synchronously and again after an await.
const seen = [];
class CallerProbe extends xpc.XpcMainHandler {
  async who(params) {
    const before = xpc.getXpcCaller();
    await new Promise((resolve) => setTimeout(resolve, params?.delay ?? 0));
    const after = xpc.getXpcCaller();
    seen.push({ tag: params?.tag, before, after });
    return after?.type ?? null;
  }

  async viaMain() {
    // A main handler calling another main handler through xpcMain.send(): the inner call's caller is main,
    // and this call's own caller is back once the inner call returns.
    await xpc.xpcMain.send('CallerProbe/who', { tag: 'inner' });
    seen.push({ tag: 'outer', after: xpc.getXpcCaller() });
  }
}
new CallerProbe();

xpc.xpcMain.handle('raw/syncThrow', () => {
  throw new Error('sync');
});
xpc.xpcMain.handle('raw/asyncThrow', async () => {
  throw new Error('async');
});

test('a renderer call sees its WebContents and frame, before and after an await', async () => {
  const sender = contents(7, frame(11, 1));
  const ret = await invoke(sender, frame(11, 1), 'CallerProbe/who', { tag: 'r', delay: 5 });
  assert.equal(ret, 'renderer');
  const entry = findSeen('r');
  assert.equal(entry.before.webContents, sender);
  assert.equal(entry.after.webContents, sender);
  assert.deepEqual(entry.after.frame, frame(11, 1));
  assert.equal(entry.after.processId, 11);
  assert.equal(entry.after.frameId, 1);
  assert.equal(entry.after.url, 'http://localhost:5173/index.html');
})

test('fields in the payload never change the caller', async () => {
  const sender = contents(8, frame(12, 1));
  await ipcHandlers.get('__xpc_exec__')(event(sender, frame(12, 1)), {
    id: 'x', handleName: 'CallerProbe/who', params: { tag: 'forged' }, type: 'main', caller: { type: 'main' }
  });
  assert.equal(findSeen('forged').after.type, 'renderer');
})

test('outside a handler call there is no caller; xpcMain.send() from main reports main', async () => {
  assert.equal(xpc.getXpcCaller(), undefined);
  assert.equal(await xpc.xpcMain.send('CallerProbe/who', { tag: 'm' }), 'main');
})

// Both orders: a save/restore "current caller" variable happens to pass when the slower call starts first.
for (const [first, second] of [[20, 5], [5, 20]]) {
  test(`interleaved calls from two renderers never see each other (delays ${first} / ${second} ms)`, async () => {
    const a = contents(1, frame(1, 1));
    const b = contents(2, frame(2, 1));
    const tagA = `a${first}`;
    const tagB = `b${second}`;
    await Promise.all([
      invoke(a, frame(1, 1), 'CallerProbe/who', { tag: tagA, delay: first }),
      invoke(b, frame(2, 1), 'CallerProbe/who', { tag: tagB, delay: second })
    ]);
    for (const [tag, sender] of [[tagA, a], [tagB, b]]) {
      assert.equal(findSeen(tag).before.webContents, sender);
      assert.equal(findSeen(tag).after.webContents, sender);
    }
  })
}

test('a main handler calling another main handler: the inner one sees main, the outer one keeps its caller', async () => {
  const sender = contents(3, frame(3, 1));
  await invoke(sender, frame(3, 1), 'CallerProbe/viaMain', undefined);
  assert.equal(findSeen('inner').after.type, 'main');
  assert.equal(findSeen('outer').after.webContents, sender);
})

test('a main emitter reports main', async () => {
  const emitter = xpc.createXpcMainEmitter('CallerProbe');
  assert.equal(await emitter.who({ tag: 'emitter' }), 'main');
})

test('a throwing handler, sync or async, returns null', async () => {
  const sender = contents(4, frame(4, 1));
  assert.equal(await invoke(sender, frame(4, 1), 'raw/syncThrow', undefined), null);
  assert.equal(await invoke(sender, frame(4, 1), 'raw/asyncThrow', undefined), null);
})

test('a utility process call reports its fork-time port id', async () => {
  xpc.createUtilityProcess({ modulePath: '/dev/null' });
  const port = utilityPorts.at(-1);
  await port.deliver({ type: '__xpc_exec__', payload: { id: 'u1', handleName: 'CallerProbe/who', params: { tag: 'u' } } });
  const entry = findSeen('u');
  assert.equal(entry.after.type, 'utility');
  assert.equal(entry.after.portId, xpc.xpcCenter.findPortId(port), 'the id the port was registered under');
  assert.equal(port.sent.at(-1).payload.ret, 'utility');
})

// The caller exactly as the IPC entry records it.
const recorded = async (sender, senderFrame) => {
  const tag = `rec${seen.length}`;
  await invoke(sender, senderFrame, 'CallerProbe/who', { tag });
  return findSeen(tag).after;
};

test('isMainFrameCaller: only the main frame of that very WebContents', async () => {
  const main = frame(10, 1);
  const view = contents(5, main);
  assert.equal(xpc.isMainFrameCaller(await recorded(view, frame(10, 1)), view), true, 'same ids, different object');
  assert.equal(xpc.isMainFrameCaller(await recorded(view, frame(10, 2)), view), false, 'a subframe');
  assert.equal(xpc.isMainFrameCaller(await recorded(view, frame(11, 1)), view), false, 'same routingId, another process');
  assert.equal(xpc.isMainFrameCaller(await recorded(contents(6, main), frame(10, 1)), view), false, 'another WebContents');
  // Electron still reports the sending frame's ids when senderFrame is already gone.
  await ipcHandlers.get('__xpc_exec__')({ sender: view, senderFrame: null, processId: 10, frameId: 1 },
    { id: 'x', handleName: 'CallerProbe/who', params: { tag: 'gone' } });
  assert.equal(xpc.isMainFrameCaller(findSeen('gone').after, view), false, 'frame gone at arrival');
  // If Electron ever stopped reporting routing ids, undefined === undefined must not pass.
  const noRoutingId = contents(5, { processId: 10 });
  assert.equal(xpc.isMainFrameCaller({ ...(await recorded(view, frame(10, 1))), frameId: undefined }, noRoutingId), false, 'ids missing');
  assert.equal(xpc.isMainFrameCaller(await recorded(view, frame(10, 1)), contents(5, main, true)), false, 'destroyed');
  assert.equal(xpc.isMainFrameCaller(await recorded(view, frame(10, 1)), null), false, 'no WebContents');
  assert.equal(xpc.isMainFrameCaller({ type: 'main' }, view), false);
  assert.equal(xpc.isMainFrameCaller(undefined, view), false);
})

test('isMainFrameCaller judges the document that sent the call, not what the frame shows now', async () => {
  // Electron keeps one WebFrameMain per frame and moves it to the new document on a cross-origin navigation.
  const live = frame(20, 1);
  const view = contents(9, live);
  const caller = await recorded(view, live);
  Object.assign(live, frame(21, 3, 'https://elsewhere.example/'));
  view.mainFrame = live;
  assert.equal(xpc.isMainFrameCaller(caller, view), false, 'the old document no longer owns the main frame');
  assert.equal(caller.url, 'http://localhost:5173/index.html', 'url is the one recorded at arrival');
  assert.equal(caller.origin, 'http://localhost:5173');
})

test('isMainFrameCaller never throws on a disposed frame', async () => {
  const disposed = () => {
    throw new Error('Render frame was disposed before WebFrameMain could be accessed');
  };
  const view = contents(13, frame(30, 1));
  const caller = await recorded(view, frame(30, 1));
  Object.defineProperty(caller.frame, 'processId', { get: disposed });
  assert.equal(xpc.isMainFrameCaller(caller, view), true, 'only the recorded ids are compared');
  Object.defineProperty(view, 'mainFrame', { get: disposed });
  assert.equal(xpc.isMainFrameCaller(caller, view), false);

  const gone = frame(31, 1);
  Object.defineProperty(gone, 'url', { get: disposed });
  const early = await recorded(contents(14, frame(31, 1)), gone);
  assert.equal(early.url, '', 'an unreadable frame at arrival records an empty url');
})
