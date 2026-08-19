# Backlog

Non-blocking findings and deferred proposals. Nothing here blocks the current sprint.

## Proposals

### B1 — `XpcUtilityProcessHandler` + `createXpcUtilityProcessEmitter`

The handler/emitter pattern (README §Usage B, the *recommended* usage) exists for main, preload, and
renderer but not for the utility layer. A utility process can only use the hard-coded
`handle()`/`send()` style.

Adding it is a mechanical mirror of `src/main/xpcMain.handler.ts` + `xpcMain.emitter.ts` over
`xpcUtilityProcess`, plus two exports from `src/utilityProcess/index.ts`. `XpcEmitterOf<T>` and
`buildXpcChannel` are already layer-agnostic.

Deferred because it was not requested — the ask was the three verbs. Recorded because it is the only
remaining asymmetry between the utility layer and the other three, and because the owner's own
Electron projects mandate the handler/emitter pattern for all IPC, which would make this a
prerequisite for adopting utility XPC there.

Ask Ral before implementing.

### B2 — Withdraw registry ownership on `removeHandle()`

`removeHandle()` drops the local handler in every layer but never tells `xpcCenter` to release the
registry entry. A `send()` to a removed name still routes to that process and resolves `null` instead
of taking the "no owner" path. Needs a new `__xpc_unregister__` wire message, so it is a protocol
addition, not a bug fix.

### B3 — Clean up routes owned by a destroyed renderer

`xpcCenter` never removes registry or subscriber entries for a destroyed `webContents`. Less severe
than the utility case that xpc-004 fixes: `exec()`'s renderer branch checks
`isDestroyed()`/`isCrashed()` and fails fast to `null`, so callers do not hang. But entries accumulate
for the process lifetime, and a recreated window with a recycled id would inherit them.

Fix shape: `app.on('web-contents-created')` → `contents.on('destroyed')` → the same scoped cleanup
`unregisterPort` performs, keyed by webContentsId.

### B4 — Per-`send()` timeout

Currently a `send()` settles only when the owner replies or the owner disappears. Neither a wedged
handler (one that never returns) nor a lost message has a bound. A timeout needs a policy decision:
default duration, opt-in vs always-on, and whether expiry resolves `null` or rejects — the latter
would break the library's "never throws to the caller" contract. Out of scope for this sprint;
invariant 4 is satisfied by lifecycle cleanup instead.

### B5 — Multiple subscribers per `handleName` within one process

Every layer stores subscriber callbacks in a `Map<handleName, callback>`, so a second `subscribe()` on
the same name silently replaces the first. Consistent across all four layers, so it is a design
choice rather than a defect — but it is undocumented, and "silently replaces" is a surprising default
for a pub/sub API. Either document it in the README or move to a callback list.

## Observations

### B6 — `xpcId` helper duplicated three times

`src/main/xpcId.helper.ts`, `src/preload/xpcId.helper.ts`, and `src/utilityProcess/xpcId.helper.ts`
are the same generator. The duplication is deliberate — bundling `src/shared/` into the preload and
renderer entries is exactly what the per-layer entry points avoid — but the files should say so, or
move into `src/shared/` with the bundler configured to inline them per entry.

### B7 — `XPC_BROADCAST_DISPATCH` was declared but unused in `src/main/xpcMain.helper.ts`

**Resolved in xpc-003.** The dead constant sat in the block that gained `XPC_EXEC`, and was dropped
in the same edit. Dispatch is posted from `xpcCenter`, which declares its own copy; the live copies in
`xpcCenter.helper.ts`, `xpcPreload.helper.ts`, and `xpcUtilityProcess.helper.ts` are untouched.

### B8 — `publish:npm` script uses npm

`"publish:npm": "npm publish --registry=…"`. The workspace mandates yarn for install/scripts; `npm
publish` is outside that list, and yarn 1.x has no clean equivalent for a scoped registry override.
Left as-is deliberately — noted so it is not "fixed" by a later sweep without thinking.
