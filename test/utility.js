// Utility process under test.
// A real consumer writes: require('electron-xpc/utilityProcess')
const { xpcUtilityProcess } = require('../dist/utilityProcess/index.js');

const readArg = (prefix, fallback) => {
  const hit = process.argv.find(a => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
};

const NAME = readArg('--name=', '?');
const BROADCAST_ONLY = process.argv.includes('--broadcast-only');

// Plain messages — main tags each line with [utility-<NAME>] when it relays
// stdout, so prefixing here would double-tag.
const log = (...parts) => console.log(parts.join(' '));

/** Broadcasts received by this process, drained by the harness per case. */
const receipts = [];

xpcUtilityProcess.subscribe('bus/ping', payload => {
  const from = payload.params?.from ?? null;
  receipts.push(from);
  log('received bus/ping from', from);
});

if (BROADCAST_ONLY) {
  // T12: this process owns ZERO handlers. Its only identity in the router is
  // its fork-time portId, which is exactly what the case proves.
  //
  // broadcast() throws until the MessagePort arrives, and the API exposes no
  // readiness signal, so retry within a bounded window.
  const attempt = (n = 0) => {
    try {
      xpcUtilityProcess.broadcast('bus/ping', { from: `utility-${NAME}` });
      log('broadcast bus/ping (owns no handlers)');
    } catch (_e) {
      if (n >= 50) {
        log('ERROR: MessagePort never initialized after 50 attempts');
        return;
      }
      setTimeout(() => attempt(n + 1), 20);
    }
  };
  attempt();
  log(`ready (broadcast-only, subscribes only)`);
} else {
  // Handlers may be registered before the port arrives; they are queued.
  xpcUtilityProcess.handle(`utility/${NAME}/echo`, async payload => {
    log('echo hit', JSON.stringify(payload.params ?? null));
    return { from: NAME, echoed: payload.params ?? null };
  });

  // T1-T4 driver: make THIS process the sender, so the case exercises the
  // utility egress path rather than main's or the renderer's.
  xpcUtilityProcess.handle(`utility/${NAME}/callOut`, async payload => {
    const target = payload.params?.target;
    log('send →', target);
    const ret = await xpcUtilityProcess.send(target, { from: `utility-${NAME}` });
    log('ret =', JSON.stringify(ret));
    return { target, ret };
  });

  // T7 driver.
  xpcUtilityProcess.handle(`utility/${NAME}/doBroadcast`, async () => {
    log('broadcast bus/ping');
    xpcUtilityProcess.broadcast('bus/ping', { from: `utility-${NAME}` });
    return { ok: true };
  });

  xpcUtilityProcess.handle(`utility/${NAME}/receipts`, async () => {
    const drained = receipts.slice();
    receipts.length = 0;
    return drained;
  });

  log('ready');
}
