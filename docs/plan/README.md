# Delivery plan

## Current sprint — utility process as a full XPC peer

Feature: [../features/utility-xpc-full-duplex.md](../features/utility-xpc-full-duplex.md) ·
Analysis: [analysis/utility-xpc.md](analysis/utility-xpc.md) · Target `1.2.0`

| Task | Scope | Requirement | depends-on | Status |
|---|---|---|---|---|
| [xpc-001](tasks/xpc-001.md) | toolchain | R5 | — | done |
| [xpc-002](tasks/xpc-002.md) | port identity | R2 R3 R4 | xpc-001 | done · [review](reviews/xpc-002-1.md) |
| [xpc-003](tasks/xpc-003.md) | utility egress | R1 | xpc-002 | done · [review](reviews/xpc-003-1.md) |
| [xpc-004](tasks/xpc-004.md) | port lifecycle | invariant 4/6 | xpc-003 | done · [review](reviews/xpc-004-1.md) |
| [xpc-005](tasks/xpc-005.md) | harness | R6 | xpc-004 | in-progress · [review](reviews/xpc-005-1.md) |
| [xpc-006](tasks/xpc-006.md) | published docs | consistency | xpc-005 | pending |

xpc-001–004 are gated on `yarn typecheck` + `yarn build` + source review. Functional evidence for
R1–R4 (the T1–T12 matrix) arrives with xpc-005 and is **not** claimed before then.

**xpc-005 is built and statically reviewed; the functional gate is unrun.** Ral runs
`yarn test:app` and clicks **Run all** himself — an agent does not boot Electron on its own
initiative. xpc-006 stays `pending` on purpose: its verification forbids documenting behavior the
harness has not exercised, so the published README is not updated until the matrix is green.

```text
xpc-001 ──► xpc-002 ──► xpc-003 ──► xpc-004 ──► xpc-005 ──► xpc-006
toolchain   identity     egress      lifecycle   harness     docs
```

Tasks execute **serially on the currently checked-out branch** (`main`). No branch or worktree
operation is part of this plan.

## Task lifecycle

```text
pending ── depends-on all done ──► ready ──► in-progress ──► done
                                                │
                                             blocked ──► fix ──► re-verify
```

Each task: develop → verify as a separate pass against the task's `verification` table, writing
`reviews/{id}-{seq}.md` → on pass, run the full check → mark `done`. Blocking findings go back to
develop; non-blocking findings go to [backlog.md](backlog.md).

## Full check

```bash
yarn typecheck   # tsc --noEmit
yarn build       # tsup, all four entries incl. DTS
```

Available only after xpc-001. Functional evidence for R1–R4 comes from the `test/` harness
(xpc-005), which is **launched by a human** — an agent does not start Electron on its own
initiative.

## Directory

```text
docs/plan/
├─ README.md          # this file — board and lifecycle
├─ analysis/          # planning input, never assigned to a develop agent
├─ tasks/             # one file per task, YAML frontmatter is the state
├─ reviews/           # {id}-{seq}.md, written by verify agents
└─ backlog.md         # non-blocking findings, deferred proposals
```
