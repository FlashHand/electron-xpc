import { ipcRenderer } from 'electron';
import { XpcPayload } from '../shared/xpc.type';
import { generateXpcId } from './xpc-id.helper';

const XPC_REGISTER = '__xpc_register__';
const XPC_EXEC = '__xpc_exec__';
const XPC_FINISH = '__xpc_finish__';

type XpcHandler = (payload: XpcPayload) => Promise<any>;

/**
 * XpcRenderer: runs in the renderer process (via preload).
 * - register({handleName}): registers a handleName with main process, also sets up local listener
 * - handle(handleName, handler): registers handler locally + sends __xpc_register__ to main
 * - send(handleName, params): invokes __xpc_exec__ on main, awaits result via ipcRenderer.invoke
 */
class XpcRenderer {
  private handlers = new Map<string, XpcHandler>();

  /**
   * Register a handleName with the main process and bind a local async handler.
   * When another renderer calls send() with this handleName, xpcCenter will forward
   * the payload to this renderer, the handler executes, and result is sent back via __xpc_finish__.
   */
  handle(handleName: string, handler: XpcHandler): void {
    this.handlers.set(handleName, handler);

    // Notify main process about this registration
    ipcRenderer.send(XPC_REGISTER, { handleName });

    // Listen for incoming handleName events forwarded by xpcCenter
    ipcRenderer.on(handleName, async (_event, payload: XpcPayload) => {
      let ret: any = null;
      const localHandler = this.handlers.get(handleName);
      if (localHandler) {
        try {
          ret = await localHandler(payload);
        } catch (_e) {
          ret = null;
        }
      }
      // Send __xpc_finish__ back to main with result
      ipcRenderer.send(XPC_FINISH, {
        id: payload.id,
        handleName: payload.handleName,
        params: payload.params,
        ret,
      } as XpcPayload);
    });
  }

  /**
   * Remove a registered handler.
   */
  removeHandle(handleName: string): void {
    this.handlers.delete(handleName);
    ipcRenderer.removeAllListeners(handleName);
  }

  /**
   * Send a message to another renderer (or any registered handler) via main process.
   * Uses ipcRenderer.invoke(__xpc_exec__) which blocks until the target finishes.
   * Returns the ret value from the target handler, or null.
   */
  async send(handleName: string, params?: any): Promise<any> {
    const payload: XpcPayload = {
      id: generateXpcId(),
      handleName,
      params,
      ret: null,
    };

    return await ipcRenderer.invoke(XPC_EXEC, payload);
  }
}

export const xpcRenderer = new XpcRenderer();

export type XpcRendererApi = {
  handle: (handleName: string, handler: (payload: XpcPayload) => Promise<any>) => void;
  removeHandle: (handleName: string) => void;
  send: (handleName: string, params?: any) => Promise<any>;
};

/**
 * Returns a contextBridge-safe object for exposeInMainWorld.
 * Usage: contextBridge.exposeInMainWorld('xpcRenderer', exposeXpcRenderer())
 */
export const exposeXpcRenderer = (): XpcRendererApi => {
  return {
    handle: (handleName: string, handler: (payload: XpcPayload) => Promise<any>): void => {
      xpcRenderer.handle(handleName, handler);
    },
    removeHandle: (handleName: string): void => {
      xpcRenderer.removeHandle(handleName);
    },
    send: (handleName: string, params?: any): Promise<any> => {
      return xpcRenderer.send(handleName, params);
    },
  };
};
