# Issue — a renderer can take over a handler name that main owns

状态：待定（未修复） · Severity P3 · Found 2026-10-18 (xpc-007 second review) · Affects `≤ 1.3.0`

## Defect

Any renderer can register any `handleName`, including one a main-process handler already owns, and the
registry keeps only the last registration:

`src/main/xpcCenter.helper.ts` (`setupListeners`, `XPC_REGISTER`)

```ts
ipcMain.on(XPC_REGISTER, (event, payload: { handleName: string }) => {
  const existing = this.registry.get(payload.handleName);
  if (existing != null && !(existing.type === 'renderer' && existing.id === event.sender.id)) {
    console.log(`[xpcCenter] handler "${payload.handleName}" overwritten: …`);
  }
  this.registry.set(payload.handleName, { type: 'renderer', id: event.sender.id });
});
```

After that, `execAs()` routes every call for the name to that renderer. The main handler — and any
`isMainFrameCaller` check inside it — never runs, and the page that called receives the renderer's reply.

## Why it matters

The caller context ([features/caller-context.md](../features/caller-context.md)) lets a main handler refuse
calls from the wrong page. A page that can reach the preload API can sidestep that by taking over the name:
it cannot make the main handler do the work, but it can answer in its place, so a trusted page may act on a
forged reply.

## Options

| Option | Effect | Cost |
|---|---|---|
| Refuse a renderer registration of a name whose current owner is `main` (log and ignore) | main-owned names cannot be taken over | an app that deliberately moves a name from main to a renderer breaks; none known |
| Keep the behaviour, document it | no code change | consumers must not trust replies from main-owned names |

Recommendation: refuse, in the next minor version, with a test that a renderer `register` of a main-owned
name leaves the route on main. Until then the limit is listed in the feature doc and both READMEs.
