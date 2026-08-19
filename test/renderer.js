// Renderer layer. Uses only window.xpcRenderer — never require() — which is
// exactly what `electron-xpc/renderer` re-exports for bundled renderer code.
const xpc = window.xpcRenderer;

if (xpc == null) {
  // Without this the first xpc.* call throws a bare TypeError, which reads like
  // a harness bug rather than the preload bridge never having been exposed.
  document.body.textContent =
    'window.xpcRenderer is missing — the preload script did not run. ' +
    'Check that dist/preload exists (yarn build) and that sandbox is false.';
  throw new Error('window.xpcRenderer is undefined');
}

const SETTLE_MS = 250; // bounded window for fire-and-forget broadcast delivery
const PROMPT_MS = 1000; // a "resolves promptly" bound for T10 / T11

const logLines = document.getElementById('logLines');
const logCount = document.getElementById('logCount');
const casesEl = document.getElementById('cases');
const resultsEl = document.getElementById('results');

/** Broadcasts received by this renderer, drained per case. */
const rendererReceipts = [];
/** id → { pass, detail } */
const results = new Map();
let utilBKilled = false;
let running = false;

const stamp = () => {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

const sourceClass = source => {
  if (source === 'main') return 'harness__log__line--main';
  if (source === 'renderer') return 'harness__log__line--rend';
  return 'harness__log__line--util';
};

/** Append to the on-screen pane. Never sends anywhere — see relay() below. */
const append = (source, message, at = stamp(), tone = '') => {
  const row = document.createElement('div');
  row.className = `harness__log__line ${sourceClass(source)} ${tone}`.trim();
  const time = document.createElement('span');
  time.className = 'harness__log__line__time';
  time.textContent = `${at} `;
  const src = document.createElement('span');
  src.className = 'harness__log__line__src';
  src.textContent = `[${source}]`;
  const text = document.createTextNode(` ${message}`);
  row.append(time, src, text);
  logLines.appendChild(row);
  logLines.scrollTop = logLines.scrollHeight;
  logCount.textContent = `${logLines.childElementCount} lines`;
};

/**
 * Renderer output: appended locally, and relayed to main so it also reaches the
 * terminal. Main prints it and does NOT broadcast it back, so this cannot loop.
 */
const log = (message, tone = '') => {
  const at = stamp();
  append('renderer', message, at, tone);
  xpc.send('log/append', { source: 'renderer', message, at });
};

// Main-process and utility-process output arrives here.
xpc.subscribe('log/line', payload => {
  const { source, message, at } = payload.params ?? {};
  append(source ?? 'main', message ?? '', at ?? stamp());
});

// ------------------------------------------------------------ renderer handlers

xpc.handle('renderer/echo', async payload => {
  log(`renderer/echo hit ${JSON.stringify(payload.params ?? null)}`);
  return { from: 'renderer', echoed: payload.params ?? null };
});

xpc.handle('renderer/receipts', async () => {
  const drained = rendererReceipts.slice();
  rendererReceipts.length = 0;
  return drained;
});

xpc.subscribe('bus/ping', payload => {
  const from = payload.params?.from ?? null;
  rendererReceipts.push(from);
  log(`received bus/ping from ${from}`);
});

// ------------------------------------------------------------------- assertions

class Failed extends Error {}

const fail = message => {
  throw new Failed(message);
};

const expectEqual = (actual, expected, what) => {
  if (actual !== expected) {
    fail(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const expectFaster = (ms, bound, what) => {
  if (ms > bound) fail(`${what}: took ${ms.toFixed(1)}ms, expected under ${bound}ms`);
};

/** Same members, order-insensitive. */
const expectReceipts = (actual, expected, who) => {
  const a = [...(actual ?? [])].sort();
  const b = [...expected].sort();
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
    fail(`${who} receipts: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const drainAll = async () => {
  await xpc.send('main/receipts');
  await xpc.send('utility/A/receipts');
  if (!utilBKilled) await xpc.send('utility/B/receipts');
  rendererReceipts.length = 0;
};

const collectAll = async () => {
  log(`waiting ${SETTLE_MS}ms for broadcast delivery`);
  await wait(SETTLE_MS);
  return {
    main: await xpc.send('main/receipts'),
    A: await xpc.send('utility/A/receipts'),
    B: utilBKilled ? null : await xpc.send('utility/B/receipts'),
    renderer: rendererReceipts.slice(),
  };
};

// ------------------------------------------------------------------- test cases

const CASES = [
  {
    group: 'utility egress (R1)',
    id: 'T1',
    title: 'utility A → main',
    run: async () => {
      const r = await xpc.send('utility/A/callOut', { target: 'main/echo' });
      expectEqual(r?.ret?.from, 'main', 'responder');
      expectEqual(r?.ret?.echoed?.from, 'utility-A', 'main saw the utility as sender');
      return 'main answered the utility';
    },
  },
  {
    id: 'T2',
    title: 'utility A → renderer',
    run: async () => {
      const r = await xpc.send('utility/A/callOut', { target: 'renderer/echo' });
      expectEqual(r?.ret?.from, 'renderer', 'responder');
      return 'renderer answered the utility';
    },
  },
  {
    id: 'T3',
    title: 'utility A → utility B',
    run: async () => {
      if (utilBKilled) fail('utility B was killed by T11 — restart the app to run T3');
      const r = await xpc.send('utility/A/callOut', { target: 'utility/B/echo' });
      expectEqual(r?.ret?.from, 'B', 'responder must be B, not A');
      return 'B answered A across two ports';
    },
  },
  {
    id: 'T4',
    title: 'utility A → itself',
    run: async () => {
      const r = await xpc.send('utility/A/callOut', { target: 'utility/A/echo' });
      expectEqual(r?.ret?.from, 'A', 'responder');
      expectEqual(r?.ret?.echoed?.from, 'utility-A', 'sender');
      return 'self-send round-tripped on one port';
    },
  },
  {
    group: 'utility ingress (R2)',
    id: 'T5',
    title: 'main → utility A',
    run: async () => {
      const r = await xpc.send('harness/mainSend', { target: 'utility/A/echo' });
      expectEqual(r?.from, 'A', 'responder');
      expectEqual(r?.echoed?.from, 'main', 'sender');
      return 'xpcMain.send reached the utility';
    },
  },
  {
    id: 'T6',
    title: 'renderer → utility A',
    run: async () => {
      const r = await xpc.send('utility/A/echo', { hello: 'from renderer' });
      expectEqual(r?.from, 'A', 'responder');
      expectEqual(r?.echoed?.hello, 'from renderer', 'params');
      return 'xpcRenderer.send reached the utility';
    },
  },
  {
    group: 'broadcast / subscribe (R3, R4)',
    id: 'T7',
    title: 'utility A broadcasts',
    run: async () => {
      await drainAll();
      await xpc.send('utility/A/doBroadcast');
      const got = await collectAll();
      expectReceipts(got.main, ['utility-A'], 'main');
      expectReceipts(got.renderer, ['utility-A'], 'renderer');
      if (!utilBKilled) expectReceipts(got.B, ['utility-A'], 'utility B');
      expectReceipts(got.A, [], 'utility A (sender must be excluded)');
      return utilBKilled ? 'main + renderer got it, A excluded' : 'main + renderer + B got it, A excluded';
    },
  },
  {
    id: 'T8',
    title: 'main broadcasts',
    run: async () => {
      await drainAll();
      await xpc.send('harness/mainBroadcast');
      const got = await collectAll();
      expectReceipts(got.A, ['main'], 'utility A');
      if (!utilBKilled) expectReceipts(got.B, ['main'], 'utility B');
      expectReceipts(got.renderer, ['main'], 'renderer');
      expectReceipts(got.main, [], 'main (sender must be excluded)');
      return 'utilities + renderer got it, main excluded';
    },
  },
  {
    id: 'T9',
    title: 'renderer broadcasts',
    run: async () => {
      await drainAll();
      xpc.broadcast('bus/ping', { from: 'renderer' });
      const got = await collectAll();
      expectReceipts(got.main, ['renderer'], 'main');
      expectReceipts(got.A, ['renderer'], 'utility A');
      if (!utilBKilled) expectReceipts(got.B, ['renderer'], 'utility B');
      expectReceipts(got.renderer, [], 'renderer (sender must be excluded)');
      return 'main + utilities got it, renderer excluded';
    },
  },
  {
    group: 'resilience',
    id: 'T10',
    title: 'send to an unknown name',
    run: async () => {
      const started = performance.now();
      const r = await xpc.send('nobody/owns/this');
      const took = performance.now() - started;
      expectEqual(r, null, 'result');
      expectFaster(took, PROMPT_MS, 'unknown-name send');
      return `resolved null in ${took.toFixed(1)}ms`;
    },
  },
  {
    id: 'T11',
    title: 'kill B, then send to B',
    run: async () => {
      if (utilBKilled) fail('utility B is already gone — restart the app to run T11 again');
      await xpc.send('harness/killB');
      utilBKilled = true;
      renderCases();

      const started = performance.now();
      const dead = await xpc.send('utility/B/echo', { hello: 'anyone?' });
      const took = performance.now() - started;
      expectEqual(dead, null, 'send to the dead utility');
      expectFaster(took, PROMPT_MS, 'send to a dead utility');

      const alive = await xpc.send('utility/A/echo', { hello: 'still there?' });
      expectEqual(alive?.from, 'A', 'surviving utility A');
      return `dead → null in ${took.toFixed(1)}ms, A unaffected`;
    },
  },
  {
    id: 'T12',
    title: 'handler-less C broadcasts',
    run: async () => {
      await drainAll();
      const forked = await xpc.send('harness/forkC');
      if (forked?.forked === false) fail('utility C was already forked — restart the app to run T12 again');
      // C retries its broadcast until its port is live, so allow fork + retry.
      log('waiting 900ms for utility C to boot and broadcast');
      await wait(900);
      const got = await collectAll();
      expectReceipts(got.main, ['utility-C'], 'main');
      expectReceipts(got.renderer, ['utility-C'], 'renderer');
      expectReceipts(got.A, ['utility-C'], 'utility A');
      return 'a utility owning zero handlers broadcast successfully';
    },
  },
];

// ------------------------------------------------------------------------- view

const renderResults = () => {
  resultsEl.replaceChildren();
  for (const c of CASES) {
    const r = results.get(c.id);
    const cell = document.createElement('span');
    const state = r == null ? 'idle' : r.pass ? 'pass' : 'fail';
    cell.className = `harness__results__cell harness__results__cell--${state}`;
    cell.textContent = `${c.id} ${r == null ? '·' : r.pass ? '✓' : '✗'}`;
    cell.title = r?.detail ?? 'not run';
    resultsEl.appendChild(cell);
    resultsEl.appendChild(document.createTextNode('  '));
  }
};

const renderCases = () => {
  casesEl.replaceChildren();
  for (const c of CASES) {
    if (c.group) {
      const head = document.createElement('div');
      head.className = 'harness__cases__group';
      head.textContent = c.group;
      casesEl.appendChild(head);
    }
    const button = document.createElement('button');
    button.setAttribute('name', `harness__case__${c.id.toLowerCase()}`);
    button.disabled = running || (c.id === 'T11' && utilBKilled);
    const id = document.createElement('span');
    id.className = 'harness__case__id';
    id.textContent = c.id;
    button.append(id, document.createTextNode(c.title));
    button.addEventListener('click', () => runOne(c));
    casesEl.appendChild(button);
  }
};

// -------------------------------------------------------------------- execution

const runOne = async c => {
  running = true;
  renderCases();
  log(`--- ${c.id} ${c.title}`);
  let outcome;
  try {
    outcome = { pass: true, detail: (await c.run()) ?? 'ok' };
  } catch (error) {
    outcome = { pass: false, detail: error instanceof Failed ? error.message : `threw: ${error?.message ?? error}` };
  }
  results.set(c.id, outcome);
  log(`${c.id} ${outcome.pass ? 'PASS' : 'FAIL'} — ${outcome.detail}`, outcome.pass ? 'harness__log__line--pass' : 'harness__log__line--fail');
  running = false;
  renderCases();
  renderResults();
  return { id: c.id, title: c.title, ...outcome };
};

const runAll = async () => {
  const out = [];
  for (const c of CASES) {
    out.push(await runOne(c));
  }
  const passed = out.filter(r => r.pass).length;
  log(`run all finished — ${passed}/${out.length} passed`, passed === out.length ? 'harness__log__line--pass' : 'harness__log__line--fail');
  return out;
};

// --auto in the main process drives the matrix through this handler.
xpc.handle('harness/runAll', async () => runAll());

document.getElementById('runAll').addEventListener('click', () => runAll());
document.getElementById('clearLog').addEventListener('click', () => {
  logLines.replaceChildren();
  logCount.textContent = '';
});

renderCases();
renderResults();
log('renderer ready');
xpc.send('harness/ready');
