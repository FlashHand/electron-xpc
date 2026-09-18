# Issue — a second `subscribe()` to the same channel silently replaces the first

**Status:** 🔧 Fixing — 2026-09-18
**Reported:** 2026-09-18 (Ral), found by an audit of every broadcast send/receive site in two
consumer apps (bitterless, micromeet-cowork)
**Area:** `subscribe()` in preload, main and utility-process

## Behaviour

Every `subscribe()` stores its callback in a `Map` keyed by `handleName`:

| Layer | Line |
|---|---|
| preload | `src/preload/xpcPreload.helper.ts:90` — `xpcSubscribers.set(handleName, callback)` |
| main | `src/main/xpcCenter.helper.ts:252` — `mainSubscriberCallbacks.set(handleName, callback)` |
| utility process | `src/utilityProcess/xpcUtilityProcess.helper.ts:108` — `subscriberCallbacks.set(handleName, callback)` |

Dispatch then reads exactly one callback per channel.

**Overwrite is the intended semantics** and stays that way — it is what guarantees that
re-subscribing the same logical consumer cannot accumulate listeners, which matters because there is
deliberately no `unsubscribe()` API.

**The defect is that it is silent.** When two *different* consumers in the same process subscribe to
one channel, the later one permanently takes the channel away from the earlier one. There is no
error, no warning, and nothing observable on the main side either: `addSubscriber()` dedupes by
`(type, id)`, so main records one subscriber whether the renderer subscribed once or twice.

The consumer app then has a handler that simply never runs, for the lifetime of that process.

## Why it matters — three live failures found in one audit

All three were in shipped code, all three silent:

| App | Channel | Loser | Consequence |
|---|---|---|---|
| micromeet-cowork | `cowork/tabs` | `menuBar.store` | `activeLocked` froze at boot state → typing a URL while a miniapp tab was active navigated that miniapp away instead of opening a new tab |
| micromeet-cowork | `cowork/workbench-visibility` | `menuBar.store` | the address-bar suggestion popup was never cleared |
| bitterless | `agent/workflows` | whichever store initialised first | only one of the workflow task bar and the chat completion projection updated |

The cowork one is the instructive case: a sibling binding read the *live* value from the winning
store, so the UI looked right while the behaviour was wrong — which is exactly why nobody found it.

## Change

Warn on the overwrite. One `console.warn` at each of the three registration points, naming the
channel and stating that the previous callback is permanently replaced.

This matches an existing precedent in this library — `xpcCenter.helper.ts:300` already logs when a
*handler* registration is overwritten.

Semantics are unchanged: the new callback still wins. The warn only makes an invisible, permanent
failure visible at the moment it is created.

## Deliberately not done

- **No fan-out.** Turning `subscribe()` into a multi-listener registry would change the documented
  overwrite contract every existing caller relies on, and would re-introduce the accumulation problem
  the missing `unsubscribe()` currently rules out. An app that genuinely needs several consumers on
  one channel should own a relay (bitterless does exactly this in
  `controlSubscriptions.service.ts`: one native subscribe per channel, fanned out to a Set).
- **No `unsubscribe()`.** Out of scope for this issue.
- **`handle()` is untouched.** It has the same overwrite shape, but main already logs that case and
  Ral scoped this change to `subscribe()`.

## Acceptance

- Subscribing twice to one channel in one process logs a warning naming that channel.
- Subscribing once logs nothing.
- Re-subscribing the *same* callback still logs — the library cannot tell a deliberate re-subscribe
  from a collision, and a false positive here is much cheaper than the silent failure it replaces.
- The second callback still wins, in all three layers.
