# Analysis — utility process as a full XPC peer

Feature: [../../features/utility-xpc-full-duplex.md](../../features/utility-xpc-full-duplex.md)

## Module decomposition

| Module | Scope | Inputs | Outputs | Depends on |
|---|---|---|---|---|
| **toolchain** | `package.json`, `tsconfig.json`, `src/typings/`, `dist/` | — | green `yarn build` + `yarn typecheck` | electron types |
| **port identity** | `xpcCenter.registerPort` / `registerPortHandler` / `findPortId` / `port2Map` | a `MessagePortMain` | a stable portId per utility process | toolchain |
| **utility egress** | `createUtilityProcess()`'s `__xpc_exec__` branch | utility `__xpc_exec__` message | `xpcCenter.exec()` result posted back as `__xpc_finish__` | port identity |
| **port lifecycle** | `xpcCenter.unregisterPort`, `XpcTask.targetPortId`, `child.on('exit')` | child exit / `kill()` | routes removed, pending tasks settled `null` | port identity |
| **harness** | `test/` | human clicks | on-screen + terminal log of all three process kinds, PASS/FAIL matrix | all of the above |
| **published docs** | `README.md`, `README_CN.md`, version | implemented behavior | accurate receivers table + flow diagram | harness result |

The three source modules all live in `src/main/` — the utility side (`src/utilityProcess/`) is
already correct and needs **no change**. That is the key finding of the audit: every defect is in the
main-process router and its port wiring, not in the utility layer's own code.

## Integration enumeration

Every "A calls B" relationship the feature must prove, with the real implementation on both ends.
Mocks are not acceptable evidence for any row.

| # | Integration | Path | Task | Harness case |
|---|---|---|---|---|
| I1 | utility → main | `send` → port `__xpc_exec__` → `exec` → local handler | xpc-003 | T1 |
| I2 | utility → renderer | `send` → port → `exec` → `webContents.send` → preload → `__xpc_finish__` | xpc-003 | T2 |
| I3 | utility A → utility B | `send` → port A → `exec` → port B `exec` → `__xpc_finish__` → port A | xpc-003 | T3 |
| I4 | utility → self | `send` → port → `exec` → same port | xpc-003 | T4 |
| I5 | main → utility | `xpcMain.send` → `exec` → port `exec` | xpc-002 | T5 |
| I6 | renderer → utility | bridge → ipc `__xpc_exec__` → `exec` → port `exec` | xpc-002 | T6 |
| I7 | utility broadcast → main + renderer + utility B | port `__xpc_broadcast__` → `broadcast` → 3 transports | xpc-002 | T7 |
| I8 | main broadcast → utility A + B + renderer | `broadcast` → port dispatch | xpc-002 | T8 |
| I9 | renderer broadcast → main + utility A + B | ipc `__xpc_broadcast__` → `broadcast` | xpc-002 | T9 |
| I10 | unregistered name | `exec` registry miss | xpc-003 | T10 |
| I11 | dead utility | `exit` → `unregisterPort` → registry miss | xpc-004 | T11 |
| I12 | handler-less utility broadcast | portId exists without any registry entry | xpc-002 | T12 |

I3 is the row most easily faked into a false pass: with a single utility process, "utility → utility"
degenerates into I4 and never exercises cross-port routing. The harness therefore **must** fork two
utility processes. Likewise I7 needs a second utility process to distinguish "sender excluded" from
"nobody received it".

## Why the split is ordered this way

```text
xpc-001 toolchain ──► xpc-002 port identity ──┬──► xpc-003 utility egress ──┐
                                              │                            ├──► xpc-005 harness ──► xpc-006 docs
                                              └──► xpc-004 port lifecycle ──┘
```

- xpc-001 first because `yarn build` is **already red** on `main`; no later task can produce
  verifiable evidence until it is green.
- xpc-002 before xpc-003/004 because both consume the stable portId. Doing egress first would mean
  writing it against `findPortId`, then rewriting it.
- xpc-003 and xpc-004 are siblings, not a chain: egress adds a branch, lifecycle adds cleanup. They
  touch the same two files, so they run serially (xpc-003 then xpc-004) rather than in parallel.
- xpc-005 last among code tasks because the harness is the only functional evidence for R1–R4, and it
  must run against finished routing.
- xpc-006 after the harness passes, so the published receivers table documents *measured* behavior.

## Task boundary check

Could xpc-003 and xpc-004 be one task? Fixing egress does not produce lifecycle cleanup, and each is
independently verifiable (T1–T4/T10 vs T11). They stay separate.

Could xpc-002 fold into xpc-003? No — xpc-002 alone already fixes R2/R3/R4 and is verifiable by
T5–T9/T12 without any egress work.
