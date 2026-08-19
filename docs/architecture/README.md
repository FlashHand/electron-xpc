# Architecture scope

## Purpose and boundary

`electron-xpc` gives every Electron process layer the **same three verbs** over one routing fabric:

| Verb | Shape | Semantics |
|---|---|---|
| `handle(name, fn)` | register | this process owns `name` and will answer invocations of it |
| `send(name, params)` | request/response, `await`-able | invoke whoever owns `name`, resolve with its return value |
| `broadcast(name, params)` / `subscribe(name, cb)` | fire-and-forget one-to-many | notify every subscriber of `name` except the sender |

The library owns **routing and transport**. It does not own serialization policy, schema validation,
retries, or timeouts. Anything not resolvable to an owner resolves to `null` — never a throw, never a
hang (see [Invariants](#invariants)).

## Relationship to other scopes

There is one scope. The four process layers are peers of each other, not layers of a stack:
`src/main/`, `src/preload/`, `src/renderer/`, `src/utilityProcess/`, with `src/shared/` holding the
wire types and the handler/emitter reflection helpers used by all four.

## Main concepts

| Term | Definition |
|---|---|
| `handleName` | Routing key. A free-form string, or `ClassName/methodName` when using the handler/emitter pattern |
| **Registry** | `handleName → owner`. Exactly one owner per `handleName`; a later `handle()` overwrites an earlier one |
| **Subscribers** | `handleName → owner[]`. Many subscribers per `handleName`, unlike the registry |
| **Task** | One in-flight `send()`, identified by an id unique within the *originating* process, parked on a semaphore until its result arrives |
| **portId** | Stable identity of one utility process's `MessagePort` pair, minted once at fork |
| **xpcCenter** | The single router. Lives only in the main process |

## Process layers

| Layer | Import path | Transport to router | Verbs |
|---|---|---|---|
| Main | `electron-xpc/main` | in-process call | handle · send · broadcast · subscribe |
| Preload | `electron-xpc/preload` | `ipcRenderer` ↔ `ipcMain` | handle · send · broadcast · subscribe |
| Renderer | `electron-xpc/renderer` | `window.xpcRenderer` bridge → preload → ipc | handle · send · broadcast · subscribe |
| Utility | `electron-xpc/utilityProcess` | `MessagePortMain` ↔ `parentPort` | handle · send · broadcast · subscribe |

```text
                          ┌──────────────────────────────┐
   Renderer ──bridge──►   │      Main process            │
   Preload  ──ipc─────►   │  ┌────────────────────────┐  │
                          │  │      xpcCenter         │  │
   Utility A ─port────►   │  │  registry              │  │
   Utility B ─port────►   │  │  subscribers           │  │
                          │  │  pendingTasks          │  │
                          │  │  ports: portId → port  │  │
                          │  └────────────────────────┘  │
                          │        xpcMain (local)       │
                          └──────────────────────────────┘
```

**Every** message crosses the main process. There is no direct renderer↔renderer or
utility↔utility channel; `xpcCenter` is the only router, which is what makes one flat `handleName`
namespace work across all layers.

## Ownership and state

| State | Owner | Lifetime |
|---|---|---|
| `registry` (`handleName → owner`) | `xpcCenter` (main) | until overwritten, or owner disappears |
| `subscribers` (`handleName → owner[]`) | `xpcCenter` (main) | until owner disappears |
| `pendingTasks` (`taskId → XpcTask`) | `xpcCenter` (main) for main/renderer/utility-targeted sends | until settled |
| `ports` (`portId → MessagePortMain`) | `xpcCenter` (main) | fork → child exit |
| local `handlers` map | each process | process lifetime |
| local `pendingTasks` map | preload (implicit, via `ipcRenderer.invoke`) and utility (explicit, semaphore) | until settled |
| `mainSubscriberCallbacks` | `xpcCenter` (main) | process lifetime |

`createUtilityProcess()` in the main process creates utility processes. Nothing else creates a
process. The router never creates a handler; it only records who claimed a name.

## Wire protocol

Constants are duplicated per layer as string literals rather than shared, because preload/renderer
bundles must not pull in main-process code. Values are the contract.

| Constant | Value | Direction | Transport |
|---|---|---|---|
| `XPC_REGISTER` | `__xpc_register__` | renderer→main, utility→main | claim ownership of a `handleName` |
| `XPC_EXEC` | `__xpc_exec__` | renderer→main (`invoke`), utility→main (port) | request invocation |
| *forward* | `exec` | main→utility (port) | forwarded invocation |
| *forward* | `<handleName>` | main→renderer (`webContents.send`) | forwarded invocation |
| `XPC_FINISH` | `__xpc_finish__` | renderer→main, utility↔main | deliver a task result |
| `XPC_SUBSCRIBE` | `__xpc_subscribe__` | renderer→main, utility→main | add self as subscriber |
| `XPC_BROADCAST` | `__xpc_broadcast__` | renderer→main, utility→main | ask the router to fan out |
| `XPC_BROADCAST_DISPATCH` | `__xpc_broadcast_dispatch__` | main→renderer, main→utility | fan-out delivery |

Two deliberate asymmetries, kept because they are load-bearing and changing them would be a
breaking wire change for no behavioral gain:

1. **Main→utility forward uses the literal `exec`, not `__xpc_exec__`.** The two names encode
   direction on a single bidirectional port: `__xpc_exec__` always means *utility is asking*, `exec`
   always means *main is asking*.
2. **`XPC_FINISH` flows both ways on the utility port.** Disambiguation is by id namespace: each
   side looks the id up only in *its own* `pendingTasks` map. A main-minted exec id never appears in
   the utility's map and vice versa, so a wrong-direction lookup is a miss and a no-op.

## Routing: `send()`

`xpcCenter.exec(handleName, params)` is the single routing decision point for every `send()` from
every layer.

```text
exec(handleName, params)
   │
   ├─ registry has no entry ──────────────────────────► resolve null
   │
   ├─ owner.type === 'main'    ─► call local handler ─► resolve its return
   │
   ├─ owner.type === 'renderer'─► webContents.send(handleName, payload)
   │                              park task on semaphore
   │                              ◄── ipc __xpc_finish__ ── unblock ─► resolve ret
   │
   └─ owner.type === 'port'    ─► port.postMessage({type:'exec', payload})
                                  park task on semaphore
                                  ◄── port __xpc_finish__ ─ unblock ─► resolve ret
```

Because the caller's transport into `exec` is independent of the target's transport out of it, all
sixteen sender×receiver combinations reduce to *caller transport* × *the table above*. The utility
sender path is the one that must reach `exec`:

```text
utility.send(name)                main process                     owner of `name`
    │                                  │                                 │
    │  port __xpc_exec__ ──────────────►                                  │
    │  [park on local semaphore]        │ xpcCenter.exec(name, params)    │
    │                                   ├─ main / renderer / port ───────►│
    │                                   │◄──────────── result ────────────┤
    │  ◄── port __xpc_finish__ ─────────┤ (replies with the utility's
    │      { id: <utility task id> }    │  ORIGINAL task id, not exec's)
    │  [unblock] ─► resolve ret         │
```

The reply must carry the utility's original task id. `exec()` mints its own id internally for the
downstream leg; those two ids are different and must not be confused.

## Routing: `broadcast()` / `subscribe()`

`subscribe()` appends `{type, id}` to `subscribers[handleName]`. It **must not** write to the
registry — subscribing is not owning.

`broadcast(handleName, params, sender)` walks `subscribers[handleName]`, skips the entry equal to
`sender`, and delivers to each remaining subscriber over that subscriber's own transport.

| Sender | Receives | Does not receive |
|---|---|---|
| Main | all subscribed renderers + all subscribed utility processes | itself |
| Renderer | main (if subscribed) + all *other* subscribed renderers + all subscribed utility processes | itself |
| Utility | main (if subscribed) + all subscribed renderers + all *other* subscribed utility processes | itself |

Self-exclusion is identity comparison on `{type, id}`. For a utility sender this requires a
**stable** portId across `subscribe()` and `broadcast()` — see below.

## Port identity

One utility process = one `MessageChannelMain` pair = **one portId, minted once at fork**, before
`port.start()`. The portId is the utility's identity for the registry, for subscriber entries, and
for lifecycle cleanup.

```text
createUtilityProcess()
  new MessageChannelMain()  →  port1 (given to child), port2 (kept in main)
  portId = xpcCenter.registerPort(port2)          ← minted exactly once
  child.postMessage({type:'xpc:init'}, [port1])
  port2.start()

  on __xpc_register__(name)  → registry[name] = {type:'port', id: portId}
  on __xpc_subscribe__(name) → subscribers[name] += {type:'port', id: portId}   (registry untouched)
  on __xpc_broadcast__(p)    → broadcast(p.handleName, p.params, {type:'port', id: portId})
  on __xpc_exec__(p)         → exec(p.handleName, p.params) → reply __xpc_finish__ with p.id
  on child exit              → xpcCenter.unregisterPort(portId)
```

Deriving portId from a *handler registration* instead would make a utility's identity depend on
whether it happens to own any handler, and would mint a fresh id per handler. Both break
self-exclusion and broadcast. See
[issues/utility-subscribe-hijacks-handler-registry.md](../issues/utility-subscribe-hijacks-handler-registry.md).

## Lifecycle

| Event | Required effect |
|---|---|
| Utility registers handler | registry entry points at its portId |
| Utility subscribes | subscriber entry appended; registry untouched |
| Utility exits or is killed | port removed; every registry entry and subscriber entry for that portId removed; every pending task targeting that portId settled with `null` |
| `handle()` on an already-owned name | ownership transfers to the new claimant (logged) |
| Renderer destroyed | *not currently cleaned up* — see [plan/backlog.md](../plan/backlog.md) |

## Public API surface

| Entry point | Exports |
|---|---|
| `electron-xpc/main` | `xpcCenter`, `xpcMain`, `createUtilityProcess`, `XpcTask`, `XpcMainHandler`, `createXpcMainEmitter`, `xpcIgnore`, types |
| `electron-xpc/preload` | `xpcRenderer` (auto-exposed to `window`), `xpcHandlers`, `XpcPreloadHandler`, `createXpcPreloadEmitter`, `xpcIgnore`, types |
| `electron-xpc/renderer` | `xpcRenderer` (bridge reference), `XpcRendererHandler`, `createXpcRendererEmitter`, `xpcIgnore`, types |
| `electron-xpc/utilityProcess` | `xpcUtilityProcess`, types |

`xpcCenter.init()` must be called once in the main process before any other layer is used.

## Design decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | One flat `handleName` namespace across all four layers | A caller never needs to know which process owns a name; targets can move between layers without touching callers |
| D2 | Unknown `handleName` resolves `null`, never throws | A `send()` to a not-yet-registered or already-gone target is normal during startup and shutdown |
| D3 | Semaphore-parked tasks rather than promise maps | Uniform with the rest of the author's `@rig-lib/semaphore`-based code and keeps `XpcTask` inspectable |
| D4 | Handler methods take 0 or 1 parameter | The wire carries a single `params` field; `XpcEmitterOf<T>` maps 2+ parameter methods to `never` so misuse is a compile error |
| D5 | Wire constants duplicated per layer, not shared | Prevents preload/renderer bundles from importing main-process modules |
| D6 | portId minted at fork, not at first handler registration | Identity must exist before the utility registers anything, otherwise broadcast-only utilities have no identity |
| D7 | Handler/emitter classes exist for main/preload/renderer but **not** utility | Deferred, not rejected — see [plan/backlog.md](../plan/backlog.md) |

## Invariants

1. Exactly one owner per `handleName` in the registry.
2. `subscribe()` never mutates the registry.
3. A sender never receives its own broadcast.
4. Every `send()` settles: with the handler's return value, or with `null`. It never throws to the
   caller and never parks forever.
5. A task result is matched to its task by an id minted in the *originating* process.
6. Every route recorded for a utility process is removed when that process exits.
7. Subscribers receive the full `XpcPayload`; the user's data is `payload.params`.

Invariant 4 is the one the current implementation violates for the utility layer — see
[issues/](../issues/).

## Module index

| Module | Doc |
|---|---|
| Utility process layer | [utilityProcess.md](utilityProcess.md) |
| Main / preload / renderer layers | published `README.md` §Usage A / §Usage B |
