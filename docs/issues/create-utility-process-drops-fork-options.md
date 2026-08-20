# Issue — `createUtilityProcess()` silently drops most of Electron's fork options

状态：已修复（2026-08-20，folded into the unreleased `1.2.0`） · Severity P2 · Found 2026-08-20 · Affects `1.1.0`

## Symptom

`createUtilityProcess()` accepts five fields — `modulePath`, `args`, `env`, `execArgv`,
`serviceName`. Electron's `ForkOptions` has more. Everything else a caller passes is **silently
ignored**: no error, no warning, no type complaint once the object widens.

Concretely unreachable today:

| Electron `ForkOptions` field | Status via `createUtilityProcess` |
|---|---|
| `cwd` | unreachable |
| `session` | unreachable |
| `partition` | unreachable |
| `stdio` | **hard-coded to `'pipe'`**, cannot be overridden |
| `allowLoadingUnsignedLibraries` | unreachable |
| `respondToAuthRequestsFromMainProcess` | unreachable |

`src/main/xpcMain.helper.ts:65-71` (the type) and `:107-131` (the per-field copy that only forwards
four of them).

## Why it matters now

Until 2026-08-20 this was survivable: a caller who needed `cwd` could fall back to native
`utilityProcess.fork()` plus their own wiring. That escape hatch was closed by design — Ral's
decision that day was to keep `createUtilityProcess()` as the **single** entry point, rejecting both
a public `attachUtilityProcess(child)` primitive and an auto-attach `fork` patch, on the grounds that
creating the process and joining it to XPC should be one expression.

With one entry point, a lossy one is not acceptable: `cwd` becomes unexpressible for the whole
library, not merely inconvenient.

The forced `stdio: 'pipe'` is the sharper edge. It is not just a missing option — it is an
undocumented policy the library imposes. A consumer who wants the child's output on the terminal
(`'inherit'`) cannot have it, and nothing tells them why.

## Root cause

The options type is a hand-written subset of `ForkOptions`, and the fork call copies fields one at a
time behind `if (x !== undefined)` guards. Every option Electron adds must be manually mirrored twice
— once in the interface, once in the copy — or it silently does not exist. This has already drifted:
`cwd`, `session`, and `partition` are all in the installed `electron@43` typings.

## Fix

Extend `Electron.ForkOptions` instead of restating it, and spread instead of copying field by field:

```ts
export interface UtilityProcessOptions extends Electron.ForkOptions {
  modulePath: string;
  args?: string[];
}

const { modulePath, args, ...forkOptions } = options;
const child = utilityProcess.fork(modulePath, args, { stdio: 'pipe', ...forkOptions });
```

`stdio: 'pipe'` stays the **default** — the README's stdout/stderr example depends on it, and it is
the sensible default for a process whose output would otherwise vanish — but it moves ahead of the
spread, so an explicit `stdio` wins. Future Electron options need no code change at all.

## Not fixed here

Nothing about the handshake, the port lifecycle, or the wire protocol. This is the options surface
only.
