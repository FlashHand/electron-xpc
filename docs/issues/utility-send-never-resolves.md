# Issue — `xpcUtilityProcess.send()` never resolves

状态：待处理 · Severity P1 · Found 2026-08-19 · Affects `1.1.0`

## Symptom

`await xpcUtilityProcess.send(name, params)` inside a utility process never settles. Not a timeout,
not a rejection — the promise is parked permanently and the calling code in the utility process
stalls at that line.

## Root cause

The utility side posts an `__xpc_exec__` message and parks on a semaphore:

`src/utilityProcess/xpcUtilityProcess.helper.ts:141-174`

```ts
this.port.postMessage({ type: XPC_EXEC, payload });   // XPC_EXEC = '__xpc_exec__'
await semaphore.takeAsync();                           // ← parks here forever
```

The main side never handles that message type. `createUtilityProcess()`'s port listener branches on
exactly four types:

`src/main/xpcMain.helper.ts:130-161`

```ts
port2.on('message', async (event) => {
  const { type, payload, handleName } = message;
  if (type === XPC_REGISTER)  { ... }
  if (type === XPC_FINISH)    { ... }
  if (type === XPC_SUBSCRIBE) { ... }
  if (type === XPC_BROADCAST) { ... }
  // no XPC_EXEC branch — the message is silently dropped
});
```

`XPC_EXEC` is not even declared among that file's constants (`xpcMain.helper.ts:7-11`), which is why
the omission reads as intentional. Nothing releases the utility's semaphore, so invariant 4 —
"every `send()` settles" — is violated.

## Contract being violated

The published `README.md` documents this path as working:

- §"Step 4: Send from Utility Process to Other Handlers" (`README.md:340-364`) shows
  `await xpcUtilityProcess.send('renderer/hello', …)` returning a renderer's reply.
- The flow diagram at `README.md:388-393` draws the exact leg that is missing:
  `xpcUtilityProcess.send(...)` → `__xpc_exec__ (port1)` → forward → `__xpc_finish__` → return.

So this is a documented-but-unimplemented path, not an undocumented gap.

## Fix

Add the missing branch in main: route through `xpcCenter.exec()` and reply on the port with the
**utility's original task id**.

```ts
if (type === XPC_EXEC && payload) {
  const ret = await xpcCenter.exec(payload.handleName, payload.params);
  port2.postMessage({
    type: XPC_FINISH,
    payload: { ...payload, ret: ret ?? null },   // payload.id = the utility's task id
  });
}
```

`xpcCenter.exec()` already dispatches to `main`, `renderer`, and `port` owners, so one branch covers
utility→main, utility→renderer, utility→utility, and utility→self. It also returns `null` for an
unregistered name, which makes T10 pass for free.

The reply id must be `payload.id` (minted in the utility). `exec()` mints a *different* id internally
for its downstream leg; using that one would never match the utility's `pendingTasks` entry and would
reproduce the hang.

## Verification

T1, T2, T3, T4, T10 in [../architecture/utilityProcess.md](../architecture/utilityProcess.md#tests).

## Task

[../plan/tasks/xpc-003.md](../plan/tasks/xpc-003.md)
