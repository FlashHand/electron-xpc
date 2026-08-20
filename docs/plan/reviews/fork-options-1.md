# Review — `createUtilityProcess()` fork-options pass-through

Post-sprint fix, folded into the unreleased `1.2.0`.
Issue: [../../issues/create-utility-process-drops-fork-options.md](../../issues/create-utility-process-drops-fork-options.md)

## Why it was done now

Ral's decision on 2026-08-20: `createUtilityProcess()` stays the **single** way to join a utility
process to XPC. A public `attachUtilityProcess(child)` primitive and an auto-attach patch of
`utilityProcess.fork` were both considered and rejected — creating the process and joining it to XPC
should be one expression, and that expression is the simplest to read.

That decision removed the escape hatch a caller needing `cwd` previously had, so the single entry
point could no longer be a lossy proxy of Electron's `ForkOptions`.

## Change

| File | Change |
|---|---|
| `src/main/xpcMain.helper.ts` | `UtilityProcessOptions` now `extends Electron.ForkOptions` instead of restating five fields; the fork call spreads `...forkOptions` instead of copying field by field behind `if (x !== undefined)` guards |
| `README.md` / `README_CN.md` | `#### Options` table under Step 1; the "use `createUtilityProcess()`, not native `fork()`" rule with its structural reason; `kill()` vs `child.kill()`; a `### Complete Minimal Example` two-file block; `Changes in 1.2.0` mentions the widening |
| `package.json` | `version_code` re-stamped `260820161244`. `version` stays `1.2.0` — npm registry still serves `1.1.0`, so nothing shipped needed a new number |

`stdio: 'pipe'` moved from hard-coded to a default placed **before** the spread, so it still applies
when the caller says nothing and an explicit `stdio` now wins.

## Verification

| Check | Result |
|---|---|
| `yarn typecheck` | pass |
| `yarn build` | pass |
| Emitted `dist/main/index.d.ts` | `interface UtilityProcessOptions extends Electron.ForkOptions` — consumers get completion on every Electron fork option |
| README section parity | pass — Broadcast 5/5 and Utility Process 11/11 subsections match one-for-one between EN and CN |
| Functional | **not run.** No change to the handshake, routing, or lifecycle paths the T1–T12 matrix covers — this is the options surface only. The harness passes `modulePath` and `args`, both unchanged in shape |

## Note for the next harness run

Nothing here is exercised by T1–T12. If a case is ever added for it, the cheap one is: fork with
`stdio: 'inherit'` and assert `child.stdout === null`, which proves the caller's value beat the
default. Not added now — it would need a second window of the manual harness for a one-line policy.

## Doc-gate note

Ral raised this mid-conversation rather than as a written requirement. The issue doc was written
before the source edit, per the docs-first rule, and records the decision that motivated it so the
reasoning is not lost in chat.
