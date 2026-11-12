# Issue — every task result carries the request's `params` back through main

状态：已修复（2026-11-12，`1.3.1`） · Severity P2 · Found 2026-11-12 (Dozin main-thread load review) · Affects `≤ 1.3.0`

## Symptom

Three `XPC_FINISH` senders copy the whole request payload into the result message:

| Sender | Code | Direction |
|---|---|---|
| preload / renderer handler | `src/preload/xpcPreload.helper.ts` (`params: payload.params`) | renderer → main |
| utility handler | `src/utilityProcess/xpcUtilityProcess.helper.ts` (`params: payload.params`) | utility → main |
| main, answering a utility-initiated `send()` | `src/main/xpcMain.helper.ts` (`{ ...payload, ret }`) | main → utility |

Every receiver of `XPC_FINISH` reads only `payload.id` and `payload.ret`
(`xpcCenter` `ipcMain.on(XPC_FINISH)`, `handleUtilityFinish`, the utility's own `pendingTasks`), and
`send()` resolves with `ret` alone. The echoed `params` is decoded by the receiving process and dropped.
A handler that mutates its `params` was never visible to the caller either: each side holds its own
structured-clone copy.

## Why it matters

Main is the router. For a large write — a renderer saving a whole chat window into a SQLite window — the
request crosses main's JS thread once on the way in and once on the way out, and then a third time inside
the result. Measured in Electron 40.10.6 with 2 MB of real chat entries (main thread CPU, 3 runs × 100
round trips): 3.44 ms per MB with the echo, 2.19 ms per MB without it (−36 %); the handler side also stops
encoding the copy (2.24 → 1.34 ms per MB). Reads (small request, large result) are unchanged.

## Fix

The three senders put only `id`, `handleName` and `ret` into `XPC_FINISH`. `handleName` stays for
diagnostics. Receivers are unchanged, so a 1.3.1 peer and an older peer interoperate in both directions.

Return data travels in the handler's return value, as before — `return { echoed: payload.params }` still
works.

## Verification

- `test/finishPayload.test.mjs` (Node, Electron stubbed, no app launched): for each of the three senders, a
  handler receives a large `params`, the `XPC_FINISH` message carries `id`, `handleName` and the correct
  `ret` and has no `params`; the caller of `send()` resolves with `ret`.
- Negative control: restoring `params` in any one sender fails its case.
- `yarn typecheck`, `yarn build`, `yarn test:unit`.
