# Feature — utility process as a full XPC peer

状态：已交付（R1–R6 全部有运行时证据，2026-08-20） · Requested 2026-08-19 · Target version `1.2.0`

## Intent

The utility process is currently a *partial* XPC peer: it can be called, but it cannot reliably call
out, and its identity in the router is unstable. Make it a full peer, then prove it with a runnable
Electron harness that a human clicks through.

## Requirements

| # | Requirement | Current state |
|---|---|---|
| R1 | A utility process can `send()` an XPC message that reaches the **main**, a **renderer**, or **another utility** process, and resolves with that handler's return value | ✗ broken — parks forever ([issue](../issues/utility-send-never-resolves.md)) |
| R2 | A utility process can `handle()` XPC messages sent from any other process | ~ works, but its route is registered against an unstable identity ([issue](../issues/utility-subscribe-hijacks-handler-registry.md)) |
| R3 | A utility process can `broadcast()` | ~ silently dropped when the utility owns no handler ([issue](../issues/utility-subscribe-hijacks-handler-registry.md)) |
| R4 | A utility process can `subscribe()` to broadcasts | ~ works, but subscribing hijacks the handler registry ([issue](../issues/utility-subscribe-hijacks-handler-registry.md)) |
| R5 | The package builds cleanly, and `electron` is a real devDependency | ✗ `yarn build` fails the DTS step |
| R6 | A `test/` directory holds an Electron app, started by a yarn command, where a human clicks buttons and sees main-process, renderer, **and utility-process** output — utility output surfaced through the main process | ✗ does not exist |

R1–R4 are Ral's items 1–4; R5 is item 5; R6 is item 6.

## Acceptance criteria

R1–R4 are accepted by the T1–T12 matrix in
[../architecture/utilityProcess.md](../architecture/utilityProcess.md#tests), driven from the R6
harness.

R5 is accepted when `yarn build` and `yarn typecheck` both exit 0 with no `electron` type errors, and
`dist/` contains only directories that correspond to a current `src/` entry.

R6 is accepted when:

| Criterion | Detail |
|---|---|
| Start | one yarn command from the repository root, no manual build step in between |
| Coverage | one button per T1–T12 case, plus a **Run all** button that executes the matrix and renders a PASS/FAIL table |
| Main output visible | on screen **and** in the terminal that launched it |
| Renderer output visible | on screen **and** relayed to the terminal through the main process |
| Utility output visible | on screen **and** in the terminal, both routed through the main process via `child.stdout` / `child.stderr` |
| Processes | two utility processes, so utility→utility is genuinely cross-process rather than a self-send |

## Out of scope

| Item | Reason |
|---|---|
| `XpcUtilityProcessHandler` / `createXpcUtilityProcessEmitter` | Not requested. The three verbs are the ask; the class/emitter sugar is a separate proposal in [../plan/backlog.md](../plan/backlog.md) |
| Per-`send()` timeouts | Requires a policy decision (default duration, error vs `null`). Invariant 4 is satisfied by lifecycle cleanup instead |
| Cleanup of routes owned by a destroyed renderer | Pre-existing gap in a different layer; recorded in backlog |
| Withdrawing registry ownership on `removeHandle()` | Pre-existing protocol gap in all layers; recorded in backlog |
| Automated (non-manual) test suite / CI | Ral asked for a human-clicked harness. No test framework exists in this repo yet |

## Traceability

| Requirement | Task |
|---|---|
| R5 | [xpc-001](../plan/tasks/xpc-001.md) |
| R2, R3, R4 | [xpc-002](../plan/tasks/xpc-002.md) |
| R1 | [xpc-003](../plan/tasks/xpc-003.md) |
| Invariant 4 (T11) | [xpc-004](../plan/tasks/xpc-004.md) |
| R6 | [xpc-005](../plan/tasks/xpc-005.md) |
| Published docs consistency | [xpc-006](../plan/tasks/xpc-006.md) |
