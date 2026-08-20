# Issue — a dead utility process leaves stale routes and hangs its callers

状态：已修复（xpc-004，2026-08-20，T11 验证） · Severity P1 · Found 2026-08-19 · Affects `1.1.0` · Fixed in `1.2.0`

## Symptom

After a utility process exits — crash, `kill()`, or normal completion — `await send(name)` for a name
that process owned parks forever. The caller (main, renderer, or another utility process) stalls.

## Root cause

Nothing unregisters a port. There is no `exit` listener anywhere in `src/main/xpcMain.helper.ts`, and
`kill()` closes the port but leaves every router record intact:

`src/main/xpcMain.helper.ts:165-168`

```ts
const kill = (): boolean => {
  port2.close();
  return child.kill();
};
```

So after exit, `xpcCenter` still holds:

| State | Stale content |
|---|---|
| `registry` | every `handleName` the dead process owned, still `{type:'port', id}` |
| `port2Map` | portId → a closed `MessagePortMain` |
| `subscribers` | every subscription the dead process held |

`exec()` then takes the `entry.type === 'port'` branch, finds the closed port, posts to it, and parks:

`src/main/xpcCenter.helper.ts:112-134`

```ts
const port2 = this.port2Map.get(entry.id as string);
if (!port2) { return null; }        // ← never taken: the entry is still there
const task = new XpcTask(payload);
this.pendingTasks.set(task.id, task);
port2.postMessage({ type: 'exec', handleName, payload });   // goes nowhere
await task.block();                 // ← parks forever
```

The `if (!port2)` guard is the intended protection, but it can only fire if the map entry was removed
— which never happens. Violates invariants 4 and 6.

Broadcast is affected less severely: `broadcast()` posts to the closed port and the message is
dropped, so subscribers are silently under-delivered rather than hung.

## Fix

1. `xpcCenter.unregisterPort(portId)` — remove the port, every registry entry pointing at it, and
   every subscriber entry for it.
2. Settle in-flight tasks targeted at that portId with `null` instead of leaving them parked. This
   needs the task to know its target, so `XpcTask` carries an optional `targetPortId`, set by
   `exec()` on the `port` branch.
3. Call `unregisterPort(portId)` from a `child.on('exit')` listener in `createUtilityProcess()`, and
   from `kill()`.

`exit` is the load-bearing hook — it covers crashes, not just explicit `kill()`.

## Verification

T11 in [../architecture/utilityProcess.md](../architecture/utilityProcess.md#tests): kill a utility
process, then `send()` to a name it owned, and require a prompt `null` rather than a hang. The
harness must also confirm the *other* utility process is unaffected — cleanup must be scoped to one
portId, not global.

## Related, out of scope

The same class of leak exists for renderer-owned routes when a `webContents` is destroyed:
`exec()`'s renderer branch checks `isDestroyed()` before sending (`xpcCenter.helper.ts:137-141`), so
it fails fast to `null` rather than hanging — but the stale registry and subscriber entries are never
cleaned. Recorded in [../plan/backlog.md](../plan/backlog.md).

## Task

[../plan/tasks/xpc-004.md](../plan/tasks/xpc-004.md)
