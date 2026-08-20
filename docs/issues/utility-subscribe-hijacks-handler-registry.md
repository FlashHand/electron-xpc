# Issue — utility port identity is derived from handler registration

状态：已修复（xpc-002，2026-08-20，T3/T7–T9/T11 验证） · Severity P1 · Found 2026-08-19 · Affects `1.1.0` · Fixed in `1.2.0`

One root cause, three observable defects.

## Root cause

`registerPortHandler()` mints a **new** portId on every call and is the *only* place a port gets an
identity:

`src/main/xpcCenter.helper.ts:61-66`

```ts
registerPortHandler(handleName: string, port2: MessagePortMain): string {
  const portId = randomUUID();                              // ← new id per handler
  this.registry.set(handleName, { type: 'port', id: portId });
  this.port2Map.set(portId, port2);
  return portId;
}
```

So a utility process's identity (a) does not exist until it registers a handler, and (b) multiplies
into N ids for N handlers, all mapping to the same port. `findPortId()` then linearly scans and
returns whichever id was inserted first (`xpcCenter.helper.ts:161-166`).

## Defect A — subscribing hijacks the handler registry

`src/main/xpcMain.helper.ts:145-152`

```ts
if (type === XPC_SUBSCRIBE && handleName) {
  let portId = xpcCenter.findPortId(port2);
  if (!portId) {
    portId = xpcCenter.registerPortHandler(handleName, port2);   // ← writes the REGISTRY
  }
  xpcCenter.addSubscriber(handleName, { type: 'port', id: portId });
}
```

When a utility process subscribes before registering any handler, main calls `registerPortHandler`,
which does `registry.set(handleName, …)`. Consequences:

1. A **broadcast-only channel becomes an invokable handler.** `xpcMain.send('language/changed')` now
   routes an `exec` to a utility process that has no such handler, resolving `null`.
2. **It steals ownership from a real handler.** If a renderer already owns `language/changed` via
   `xpcRenderer.handle()`, a utility process merely *subscribing* to that name overwrites the
   registry entry. Every subsequent `send('language/changed')` stops reaching the renderer. Broadcast
   and request/response share one `handleName` namespace, so identical names across the two verbs are
   expected usage, not a naming mistake.

Violates invariant 2: `subscribe()` must never mutate the registry.

## Defect B — a broadcast-only utility cannot broadcast

`src/main/xpcMain.helper.ts:154-160`

```ts
if (type === XPC_BROADCAST && payload) {
  const senderPortId = xpcCenter.findPortId(port2);
  if (senderPortId) {                     // ← undefined when no handler was ever registered
    xpcCenter.broadcast(...);
  }
}
```

A utility process that only produces events — never `handle()`, never `subscribe()` — has no portId,
so `findPortId` returns `undefined` and the broadcast is **silently discarded**. No error, no log.

## Defect C — unbounded portId growth and ambiguous self-exclusion

Every `handle()` call adds another `port2Map` entry that is never removed, so the map grows with
handler count rather than process count. Self-exclusion during broadcast compares `{type, id}`, and
which of the N ids `findPortId` returns depends on `Map` insertion order — a utility process can
therefore receive its own broadcast, violating invariant 3.

## Fix

Mint the portId **once per utility process, at fork**, and separate the two concerns:

| Concern | New API |
|---|---|
| Port identity | `xpcCenter.registerPort(port) → portId`, called from `createUtilityProcess()` before `port.start()` |
| Handler ownership | `xpcCenter.registerPortHandler(handleName, portId)` — maps a name to an *existing* portId, never mints |
| Reverse lookup | `WeakMap<MessagePortMain, string>`, O(1), replaces the linear scan |

Then in `createUtilityProcess()` the portId is a closure variable available to all four branches, so
`__xpc_subscribe__` and `__xpc_broadcast__` no longer need `findPortId` at all and never touch the
registry.

## Verification

T5, T6, T7, T8, T9, T12 in [../architecture/utilityProcess.md](../architecture/utilityProcess.md#tests).
T7 and T12 specifically pin defects A/B/C: T7 requires the sender to be excluded while a *second*
utility process receives, T12 requires a handler-less utility process to broadcast successfully.

## Task

[../plan/tasks/xpc-002.md](../plan/tasks/xpc-002.md)
