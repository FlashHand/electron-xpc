# electron-xpc — documentation index

Type-safe, async/await cross-process communication for Electron across four process layers:
**main**, **preload**, **renderer**, **utility process**.

## Design docs

| Doc | Content |
|---|---|
| [architecture/README.md](architecture/README.md) | Process layers, wire protocol, routing registry, port identity, broadcast model, invariants |
| [architecture/utilityProcess.md](architecture/utilityProcess.md) | Utility-process layer contract: API, state, errors, lifecycle |

## Features

| Doc | Status |
|---|---|
| [features/utility-xpc-full-duplex.md](features/utility-xpc-full-duplex.md) | in delivery |

## Issues

| Doc | Status |
|---|---|
| [issues/utility-send-never-resolves.md](issues/utility-send-never-resolves.md) | 待处理 |
| [issues/utility-subscribe-hijacks-handler-registry.md](issues/utility-subscribe-hijacks-handler-registry.md) | 待处理 |
| [issues/utility-exit-leaves-stale-routes.md](issues/utility-exit-leaves-stale-routes.md) | 待处理 |

## Delivery

| Doc | Content |
|---|---|
| [plan/README.md](plan/README.md) | Current sprint, task board, task lifecycle |
| [plan/analysis/utility-xpc.md](plan/analysis/utility-xpc.md) | Module decomposition + integration enumeration for the utility layer |
| [plan/backlog.md](plan/backlog.md) | Non-blocking findings and deferred proposals |

## User-facing docs

`README.md` (English) and `README_CN.md` (Chinese) at the repository root are the published API
documentation. They are **derived** from `docs/architecture/` — when a contract changes, the design
doc changes first and the READMEs are updated in the same task.
