const path = require('path');
const { app, BrowserWindow } = require('electron');
// A real consumer writes: require('electron-xpc/main')
const { xpcCenter, xpcMain, createUtilityProcess } = require('../dist/main/index.js');

/** --auto runs the whole matrix headlessly, prints a table, and exits. */
const AUTO = process.argv.includes('--auto');

/** Wall-clock stamp, so main / renderer / utility lines are comparable. */
const stamp = () => {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

let win = null;
let utilA = null;
let utilB = null;
let utilC = null;

/** Broadcasts received by the main process, drained by the harness per case. */
const mainReceipts = [];

/**
 * Single log path for main-process and utility-process output:
 * terminal via console.log, on-screen via broadcast to the renderer.
 * The renderer never re-broadcasts these, so there is no feedback loop.
 */
const emit = (source, message) => {
  const at = stamp();
  console.log(`${at} [${source}] ${message}`);
  xpcMain.broadcast('log/line', { source, message, at });
};

// ---------------------------------------------------------------- main handlers

xpcMain.handle('main/echo', async payload => {
  emit('main', `main/echo hit ${JSON.stringify(payload.params ?? null)}`);
  return { from: 'main', echoed: payload.params ?? null };
});

xpcMain.handle('main/receipts', async () => {
  const drained = mainReceipts.slice();
  mainReceipts.length = 0;
  return drained;
});

/** Renderer relays its own lines here so they reach the terminal too. */
xpcMain.handle('log/append', async payload => {
  const { source, message, at } = payload.params ?? {};
  console.log(`${at ?? stamp()} [${source ?? 'renderer'}] ${message}`);
  return null;
});

/** T5: the SEND must originate in main, not in the renderer. */
xpcMain.handle('harness/mainSend', async payload => {
  const target = payload.params?.target;
  const ret = await xpcMain.send(target, { from: 'main' });
  emit('main', `xpcMain.send(${target}) → ${JSON.stringify(ret)}`);
  return ret;
});

/** T8: the BROADCAST must originate in main. */
xpcMain.handle('harness/mainBroadcast', async () => {
  emit('main', 'broadcast bus/ping');
  xpcMain.broadcast('bus/ping', { from: 'main' });
  return { ok: true };
});

/** T11: kill utility B so the next send to it must resolve null, not hang. */
xpcMain.handle('harness/killB', async () => {
  if (!utilB) {
    emit('main', 'utility B already gone');
    return { killed: false };
  }
  emit('main', 'killing utility B');
  utilB.kill();
  utilB = null;
  return { killed: true };
});

/** T12: fork a utility process that owns no handlers and only broadcasts. */
xpcMain.handle('harness/forkC', async () => {
  if (utilC) {
    emit('main', 'utility C already forked');
    return { forked: false };
  }
  utilC = forkUtility('C', ['--broadcast-only']);
  return { forked: true };
});

xpcMain.subscribe('bus/ping', payload => {
  const from = payload.params?.from ?? null;
  mainReceipts.push(from);
  emit('main', `received bus/ping from ${from}`);
});

/** The renderer reports readiness here; in --auto this kicks off the run. */
xpcMain.handle('harness/ready', async () => {
  emit('main', 'renderer ready');
  if (AUTO) {
    // Let the utility processes finish registering before the first case.
    setTimeout(runAuto, 400);
  }
  return { auto: AUTO };
});

// ---------------------------------------------------------------- process setup

const forkUtility = (name, extraArgs = []) => {
  const handle = createUtilityProcess({
    modulePath: path.join(__dirname, 'utility.js'),
    args: [`--name=${name}`, ...extraArgs],
    serviceName: `xpc-harness-${name}`,
  });

  // R6's explicit requirement: utility output is surfaced through the main
  // process via the piped child streams, not over an XPC channel.
  const pipe = (stream, suffix) => {
    stream?.on('data', chunk => {
      for (const raw of chunk.toString().split('\n')) {
        const line = raw.trimEnd();
        if (line) emit(`utility-${name}`, `${line}${suffix}`);
      }
    });
  };
  pipe(handle.child.stdout, '');
  pipe(handle.child.stderr, '  (stderr)');

  handle.child.on('exit', code => emit('main', `utility ${name} exited, code ${code}`));
  emit('main', `forked utility ${name}`);
  return handle;
};

const createWindow = () => {
  win = new BrowserWindow({
    width: 1180,
    height: 840,
    minWidth: 800,
    minHeight: 600,
    show: !AUTO,
    title: 'electron-xpc harness',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false, // preload must require() the built bundle
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
};

// -------------------------------------------------------------------- auto mode

const printTable = results => {
  console.log('\n=== electron-xpc utility XPC matrix ===');
  if (!Array.isArray(results)) {
    console.log('FAIL  the renderer returned no results');
    return false;
  }
  for (const r of results) {
    const flag = r.pass ? 'PASS' : 'FAIL';
    console.log(`${flag}  ${String(r.id).padEnd(4)}${String(r.title).padEnd(36)}${r.detail ?? ''}`);
  }
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    console.log(`failed: ${failed.map(r => r.id).join(', ')}`);
  }
  return failed.length === 0 && results.length > 0;
};

const runAuto = async () => {
  let ok = false;
  try {
    ok = printTable(await xpcMain.send('harness/runAll'));
  } catch (error) {
    console.error('auto run threw', error);
  }
  app.exit(ok ? 0 : 1);
};

// ------------------------------------------------------------------------- boot

app.whenReady().then(() => {
  xpcCenter.init();
  emit('main', `xpcCenter ready${AUTO ? ' (auto mode)' : ''}`);

  utilA = forkUtility('A');
  utilB = forkUtility('B');

  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
