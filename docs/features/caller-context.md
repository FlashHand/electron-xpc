# Feature — caller context for main-process handlers

状态：已实现，待 T13 与发布 · Requested 2026-10-18 (Ral:「先给 electron-xpc 加发送方」) · Target version `1.3.0`

## Intent

A main-process handler cannot tell who called it. `xpcCenter` registers
`ipcMain.handle('__xpc_exec__', (_event, payload) => this.exec(...))` and drops `event.sender` /
`event.senderFrame`; `XpcMainHandler` then calls the method with `payload.params` only.

Consumers that must accept a call only from one specific page had to work around it. Dozin and Cowork
(extension approvals, env-variable reveal, Chrome cookie import) pass a random capability through
`additionalArguments` and check the bound page's *state* (visible, focused, on the right route). That
token is visible to any same-user process through `ps`, and the check never proves the call came from
that page (Dozin `docs/features/extension-host.md` #11, review finding P2-1).

Give main-process handlers the caller, without changing how handlers or emitters are written.

## Requirements

| # | Requirement |
|---|---|
| R1 | `getXpcCaller()`, exported from `electron-xpc/main`, returns the caller of the main-process handler call it runs inside — synchronously and after any number of `await`s. Outside a handler call it returns `undefined`. |
| R2 | Caller shapes: a renderer call → `{ type: 'renderer', webContents, frame, processId, frameId, origin, url }` — `processId` / `frameId` from the invoke event and `origin` / `url` read from `senderFrame`, all copied when the call arrives (`''` if unreadable); `frame` is the live `senderFrame` or `null`; `xpcMain.send()` from main → `{ type: 'main' }`; a utility process's `send()` → `{ type: 'utility', portId }`. Only the most recent hop is reported. |
| R3 | Concurrent calls never see each other's caller (per-call context via `AsyncLocalStorage`). A main handler that itself calls `xpcMain.send()` makes the inner handler see `{ type: 'main' }`. |
| R4 | `isMainFrameCaller(caller, webContents)` answers the question consumers actually ask: was this call sent by the frame that is now the main frame of that `WebContents`? It compares the recorded `processId` + `frameId` with `webContents.mainFrame` — never the live `frame`, which Electron moves to the new document on a cross-origin navigation. A destroyed or missing `WebContents`, a frame missing at arrival, any non-renderer caller, or any access error is `false`; it never throws. |
| R5 | Backward compatible: no change to handler method signatures (still 0 or 1 parameter), emitter types, the wire protocol, or renderer / utility handlers. Existing apps upgrade without code changes. |
| R6 | Covered by an automated test that does not launch Electron (Electron's main-process API is stubbed), plus a harness case (T13) a human runs. |

## Not in scope

- Caller context for **renderer** or **utility-process** handlers. They receive calls forwarded by main;
  their caller can be added later with a wire-protocol field if a consumer needs it.
- Authorisation policy. The library reports who called; deciding what that caller may do stays with the
  application.

## Limits consumers must know (review 2026-10-18)

| Limit | What the consumer does |
|---|---|
| A same-site navigation can keep the frame, so `isMainFrameCaller` cannot tell two documents of that site apart | pin `caller.url` (or `caller.origin`), or block navigation with `will-navigate`. Pages loaded with `loadFile` all share the `file://` origin, so compare the url's path — a hash route only changes the fragment |
| A same-origin iframe or popup can call through the main frame's preload API (`top.xpcRenderer`), and that call is sent by the main frame | do not load untrusted same-origin content; deny `window.open` with `setWindowOpenHandler` |
| Only the most recent hop is reported: renderer → main handler → `xpcMain.send()` shows `main` | do not treat `main` / `utility` as "no renderer upstream" |
| Code the handler calls directly (a method call, `xpcMain.getHandler(name)(payload)`, a main subscriber fired by `xpcMain.broadcast()`) sees the handler's caller, not `main`; timers or loops started inside a handler keep it after the handler returns | read `getXpcCaller()` at handler entry and pass it on explicitly |
| A renderer can register a handler name that main owns and take over its calls; the main handler and its check then never run, and the page that called gets the renderer's reply (pre-existing, [issue](../issues/renderer-register-overrides-main-handler.md)) | until fixed, do not rely on a reply from a main handler as proof that the check ran |

## API

```ts
import { getXpcCaller, isMainFrameCaller, type XpcCaller } from 'electron-xpc/main'

class ExtensionHandler extends XpcMainHandler {
  async approve(params: { name: string; hash: string }) {
    // Settings view's main frame only; anything else is refused before work starts.
    if (!isMainFrameCaller(getXpcCaller(), settingsView.webContents)) throw new Error('untrusted caller')
    // …
  }
}
```

```ts
export type XpcCaller =
  | {
      type: 'renderer'
      webContents: Electron.WebContents
      frame: Electron.WebFrameMain | null // live; follows the frame to later documents
      processId: number // recorded on arrival, with frameId / origin / url
      frameId: number
      origin: string
      url: string
    }
  | { type: 'main' }
  | { type: 'utility'; portId: string } // opaque, stable for that process's lifetime
```

## Acceptance

| Check | Evidence |
|---|---|
| `yarn typecheck`, `yarn build` exit 0 | command output |
| R1–R4 | `test/callerContext.test.mjs` (`yarn test:unit`, 12 cases): renderer / main / utility / emitter callers, `undefined` outside a call, interleaved calls in both orders (before and after the await), nested `xpcMain.send()` with the outer caller restored, forged payload fields, throwing handlers → `null`, `isMainFrameCaller` true / false cases incl. same `routingId` in another process, a frame moved to another document, disposed frames — run with plain Node against `dist/` with Electron stubbed. Mutation checks 2026-10-18 ([xpc-007-2](../plan/reviews/xpc-007-2.md)): a save/restore variable, a `routingId`-only compare, reading the live frame's ids, dropping the try/catch, the frame guard or the integer guard, and a wrong utility `portId` each fail the suite |
| R5 | existing handler code and the T1–T12 harness unchanged; handler and emitter types unchanged; `xpcCenter.exec(handleName, params)` keeps its 1.2.0 signature (the caller-taking entry is the new `execAs`) |
| R6 | harness case T13 (renderer button → main handler reports caller type and main-frame check); run by Ral |

## Consumers after release

Dozin and Cowork move extension approvals, env-variable reveal and Chrome cookie import from the
`additionalArguments` capability to `isMainFrameCaller(getXpcCaller(), boundContents)` — tracked in
their own repositories.
