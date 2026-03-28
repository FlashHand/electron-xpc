import { utilityProcess, MessageChannelMain } from 'electron';
import { XpcPayload } from '../shared/xpc.type';
import { xpcCenter } from './xpcCenter.helper';

type XpcHandler = (payload: XpcPayload) => Promise<any>;

const XPC_REGISTER = '__xpc_register__';
const XPC_FINISH = '__xpc_finish__';

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

    if (type === XPC_REGISTER) {
      console.log(`[xpcMain] Utility process registered handler: ${handleName}`);
      // Register with xpcCenter so other processes can call this handler
      xpcCenter.registerPortHandler(handleName, port2);
    }

    if (type === XPC_FINISH && payload) {
      // Forward finish to xpcCenter for tasks initiated by renderer processes
      xpcCenter.handleUtilityFinish(payload);
    }
  });

  port2.start();

  const kill = (): boolean => {
    port2.close();
    return child.kill();
  };

  return {
    child,
    kill,
  };
}
