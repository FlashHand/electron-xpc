import { utilityProcess, MessageChannelMain } from 'electron';
import { XpcPayload } from '../shared/xpc.type';
import { xpcCenter } from './xpcCenter.helper';

type XpcHandler = (payload: XpcPayload) => Promise<any>;

const XPC_REGISTER = '__xpc_register__';
const XPC_EXEC = '__xpc_exec__';
const XPC_FINISH = '__xpc_finish__';
const XPC_SUBSCRIBE = '__xpc_subscribe__';
const XPC_BROADCAST = '__xpc_broadcast__';

/**
 * XpcMain: runs in the main process.
 * - handle(): register a handler callable by renderers or other main-process code.
 * - send(): invoke a registered handleName (main-process or renderer), delegating to xpcCenter.
 */
class XpcMain {
  private handlers = new Map<string, XpcHandler>();

  /**
   * Register a handler in the main process.
   * When another renderer calls send() with this handleName, xpcCenter will
   * invoke this handler directly (webContentsId = 0) without forwarding to a renderer.
   */
  handle(handleName: string, handler: XpcHandler): void {
    this.handlers.set(handleName, handler);
    xpcCenter.registerMainHandler(handleName);
  }

  /**
   * Get the registered handler for a given handleName.
   */
  getHandler(handleName: string): XpcHandler | undefined {
    return this.handlers.get(handleName);
  }

  /**
   * Send a message to a registered handler by handleName.
   * Delegates to xpcCenter.exec() which handles both main-process and renderer targets.
   */
  async send(handleName: string, params?: any): Promise<any> {
    return xpcCenter.exec(handleName, params);
  }

  /**
   * Subscribe to a handleName in the main process.
   * The callback will be invoked when another process broadcasts to this handleName.
   */
  subscribe(handleName: string, callback: (payload: XpcPayload) => void): void {
    xpcCenter.registerMainSubscriber(handleName, callback);
  }

  /**
   * Broadcast to all subscribers of a handleName, excluding the main process (self).
   * Fire-and-forget: does not wait for subscriber responses.
   */
  broadcast(handleName: string, params?: any): void {
    xpcCenter.broadcast(handleName, params, { type: 'main', id: 0 });
  }
}

export const xpcMain = new XpcMain();

export interface UtilityProcessOptions {
  modulePath: string;
  args?: string[];
  env?: Record<string, string>;
  execArgv?: string[];
  serviceName?: string;
}

export interface XpcUtilityProcess {
  child: Electron.UtilityProcess;
  kill: () => boolean;
}

/**
 * Create a utility process with XPC communication support.
 * Sets up MessagePort for bidirectional communication between main and utility process.
 * The utility process uses xpcUtilityProcess.handle() to register handlers.
 * Other processes (renderer/main) can call these handlers via xpcRenderer.send() or xpcMain.send().
 * 
 * @param options - Configuration for the utility process
 * @returns XpcUtilityProcess object with child process and kill method
 * 
 * @example
 * ```ts
 * // In main process
 * const worker = createUtilityProcess({
 *   modulePath: path.join(__dirname, 'worker.js')
 * });
 * 
 * // Listen to stdout/stderr
 * worker.child.stdout?.on('data', (data) => console.log(data.toString()));
 * 
 * // In utility process (worker.js)
 * import { xpcUtilityProcess } from 'electron-xpc/utilityProcess';
 * xpcUtilityProcess.handle('processData', async (payload) => {
 *   return { result: 'processed' };
 * });
 * 
 * // In renderer process
 * const result = await xpcRenderer.send('processData', { input: 'test' });
 * ```
 */
export function createUtilityProcess(options: UtilityProcessOptions): XpcUtilityProcess {
  const { modulePath, args, env, execArgv, serviceName } = options;

  const { port1, port2 } = new MessageChannelMain();

  // Mint this utility process's identity once, before any message can arrive.
  // Every register/subscribe/broadcast below reuses it, so the process is a
  // single subscriber identity regardless of how many handlers it registers —
  // and a process that registers none still has an identity to broadcast with.
  const portId = xpcCenter.registerPort(port2);

  const forkOptions: any = {
    stdio: 'pipe',
  };
  
  if (env !== undefined) {
    forkOptions.env = env;
  }
  if (execArgv !== undefined) {
    forkOptions.execArgv = execArgv;
  }
  if (serviceName !== undefined) {
    forkOptions.serviceName = serviceName;
  }
  
  const child = utilityProcess.fork(modulePath, args, forkOptions);

  child.postMessage({ type: 'xpc:init' }, [port1]);

  port2.on('message', async (event: Electron.MessageEvent) => {
    const message = event.data;
    const { type, payload, handleName } = message;

    if (type === XPC_REGISTER && handleName) {
      console.log(`[xpcMain] Utility process registered handler: ${handleName}`);
      // Register with xpcCenter so other processes can call this handler
      xpcCenter.registerPortHandler(handleName, portId);
    }

    if (type === XPC_EXEC && payload) {
      // Utility process is invoking a handler owned by main, a renderer, another
      // utility process, or itself. xpcCenter.exec() resolves the owner, and
      // returns null for an unregistered handleName instead of blocking.
      const ret = await xpcCenter.exec(payload.handleName, payload.params);
      // The reply MUST carry payload.id — the id minted inside the utility
      // process. exec() mints a different id for its own downstream leg; using
      // that one would never match the utility's pending task and the caller's
      // send() would stay parked forever.
      port2.postMessage({
        type: XPC_FINISH,
        payload: { ...payload, ret: ret ?? null } as XpcPayload,
      });
    }

    if (type === XPC_FINISH && payload) {
      // Forward finish to xpcCenter for tasks initiated by renderer processes
      xpcCenter.handleUtilityFinish(payload);
    }

    if (type === XPC_SUBSCRIBE && handleName) {
      // Subscribing is not owning: only the subscriber list is touched here.
      // Writing the registry would steal `handleName` from whichever process
      // actually handles it, since broadcast and send share one namespace.
      xpcCenter.addSubscriber(handleName, { type: 'port', id: portId });
    }

    if (type === XPC_BROADCAST && payload) {
      // Sender identity is the fork-time portId, so a handler-less utility
      // process can broadcast too.
      xpcCenter.broadcast(payload.handleName, payload.params, { type: 'port', id: portId });
    }
  });

  port2.start();

  // Covers crashes and self-exit, not just explicit kill().
  child.on('exit', () => {
    xpcCenter.unregisterPort(portId);
  });

  const kill = (): boolean => {
    // Unregister before closing so pending callers settle immediately rather
    // than waiting for the 'exit' event. unregisterPort() is idempotent.
    xpcCenter.unregisterPort(portId);
    port2.close();
    return child.kill();
  };

  return {
    child,
    kill,
  };
}
