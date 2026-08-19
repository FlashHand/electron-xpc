# Utility process layer

Import path: `electron-xpc/utilityProcess` · Source: `src/utilityProcess/`

## Purpose

Make an Electron [utility process](https://www.electronjs.org/docs/latest/api/utility-process) a
first-class XPC peer: it can own handlers, invoke handlers owned by any other process, broadcast, and
subscribe — with the same three verbs and the same `handleName` namespace as every other layer.

## Boundary

| Owns | Delegates |
|---|---|
| Local handler map, local subscriber-callback map, local pending-task map | All routing → `xpcCenter` in main |
| Queueing `handle()` / `subscribe()` calls made before the port arrives | Process creation, `stdio` piping, exit handling → `createUtilityProcess()` in main |
| Replying to forwarded `exec` messages | Deciding *who* owns a target `handleName` |

The utility layer never talks to a renderer or another utility process directly. It has exactly one
channel: its `MessagePort` to main.

## Types

```ts
type XpcPayload = {
  id: string;          // unique within the process that minted it
  handleName: string;
  params?: any;        // caller data — subscribers read this, not the payload itself
  ret?: any;           // result, defaults to null
};

interface XpcUtilityProcessApi {
  handle:       (handleName: string, handler: (payload: XpcPayload) => Promise<any>) => void;
  removeHandle: (handleName: string) => void;
  send:         (handleName: string, params?: any) => Promise<any>;
  subscribe:    (handleName: string, callback: (payload: XpcPayload) => void) => void;
  broadcast:    (handleName: string, params?: any) => void;
}
```

Everything crossing the port must be structured-cloneable. Functions, class instances, and
`Symbol`s are not.

## API

### `handle(handleName, handler)`

Claims `handleName` for this utility process. Re-registering the same name replaces the previous
handler rather than stacking. The claim is forwarded to main as `__xpc_register__`, which sets
`registry[handleName] = {type:'port', id: portId}` — so a later claim from *any* layer takes
ownership away from this one.

Callable at module top level, before the port arrives: pending registrations are queued and replayed
in order by `init()`.

### `send(handleName, params?) → Promise<any>`

Invokes whoever owns `handleName` — main, a renderer, another utility process, or **this** utility
process — and resolves with that handler's return value.

| Case | Resolves with |
|---|---|
| Owner returned a value | that value |
| Owner returned `undefined` | `null` |
| Owner's handler threw | `null` |
| No owner registered for `handleName` | `null` |
| Owner is a utility process that has exited | `null` |
| Port not yet initialized | **throws** `Error('[xpcUtilityProcess] MessagePort not initialized. Call init() first.')` |

The port-not-initialized case is the single throwing path in the API, and it is a programming error
(calling `send()` at module top level), not a routing outcome. `handle()` and `subscribe()`
deliberately queue instead of throwing, because registering early is the normal pattern.

Round trip:

```text
send() mints taskId ─► port __xpc_exec__ {payload.id = taskId}
                       park on semaphore
main: exec(handleName, params)   ← mints its OWN downstream id
main: port __xpc_finish__ {payload.id = taskId, ret}
                       unblock ─► resolve ret ?? null
```

### `subscribe(handleName, callback)`

Adds this utility process to `subscribers[handleName]`. **One callback per `handleName`** — a second
`subscribe()` on the same name replaces the first. The callback receives the full `XpcPayload`; user
data is `payload.params`. A callback that throws is swallowed.

Queued when called before the port arrives, like `handle()`.

### `broadcast(handleName, params?)`

Fire-and-forget fan-out to every subscriber of `handleName` **except this process**. Returns
`void` — there is no delivery confirmation and no subscriber count. Throws only if the port is not
initialized.

Works whether or not this utility process owns any handler, because its identity is its portId, not a
handler registration.

### `removeHandle(handleName)`

Drops the local handler. The registry entry in main is **not** withdrawn — a subsequent `send()` to
that name still routes here and resolves `null`. Withdrawing registry ownership is not part of the
current protocol.

## State

| State | Reset when |
|---|---|
| `port` | never — set once by `init()` |
| `handlers` | per `handle()` / `removeHandle()` |
| `subscriberCallbacks` | per `subscribe()` |
| `pendingTasks` | each entry deleted when its `send()` settles |
| `pendingHandlers`, `pendingSubscribers` | drained and emptied by `init()` |

`init(port)` is called automatically: the module installs a `process.parentPort` listener at import
time and initializes on the `{type:'xpc:init'}` message that `createUtilityProcess()` sends with
`port1` transferred. Import the module; do not call `init()` by hand.

## Errors

| Condition | Behavior |
|---|---|
| Handler throws | caught, `ret = null` sent back; caller resolves `null` |
| Subscriber callback throws | caught and ignored |
| `send()` before port init | throws (programming error) |
| `broadcast()` before port init | throws (programming error) |
| Target owner unreachable / gone | resolves `null` |

No error is propagated across the port. A caller cannot distinguish "handler threw" from "handler
returned null" — by design; carry an explicit result shape in `params`/return value if the
distinction matters.

## Extension points

- `createUtilityProcess({modulePath, args, env, execArgv, serviceName})` — `stdio` is always
  `'pipe'`, so `child.stdout` / `child.stderr` are the way to surface utility `console.log` output
  in the main process.
- `child` (the raw `Electron.UtilityProcess`) is returned unwrapped for `exit` / `error` listeners.

## Tests

Contract behavior that must be covered by the manual harness in `test/` (see
[../plan/tasks/xpc-005.md](../plan/tasks/xpc-005.md)):

| # | Case | Expected |
|---|---|---|
| T1 | utility → main `send` | resolves main handler's return |
| T2 | utility → renderer `send` | resolves renderer handler's return |
| T3 | utility A → utility B `send` | resolves B's return |
| T4 | utility → own handler `send` | resolves own return |
| T5 | main → utility `send` | resolves utility handler's return |
| T6 | renderer → utility `send` | resolves utility handler's return |
| T7 | utility `broadcast` | main + renderer + utility B receive; sender does not |
| T8 | main `broadcast` | both utilities + renderer receive |
| T9 | renderer `broadcast` | main + both utilities receive |
| T10 | `send` to unregistered name | resolves `null`, promptly |
| T11 | `send` to a killed utility process | resolves `null`, promptly |
| T12 | broadcast-only utility (owns no handler) | fan-out still delivered |
