import { contextBridge, ipcRenderer } from 'electron';
import { XpcPayload, XpcRendererApi } from '../shared/xpc.type';
import { generateXpcId } from './xpcId.helper';

const XPC_REGISTER = '__xpc_register__';
const XPC_EXEC = '__xpc_exec__';
const XPC_FINISH = '__xpc_finish__';

type XpcHandler = (payload: XpcPayload) => Promise<any>;

/** Global handlers map, extracted from XpcRenderer class */
export const xpcHandlers = new Map<string, XpcHandler>();

export type { XpcRendererApi } from '../shared/xpc.type';

/**
 * Register a handleName with the main process and bind a local async handler.
 * When another renderer calls send() with this handleName, xpcCenter will forward
 * the payload to this renderer, the handler executes, and result is sent back via __xpc_finish__.
 */
const handle = (handleName: string, handler: XpcHandler): void => {
  // Remove existing listener to prevent stacking when the same handleName is re-registered
  if (xpcHandlers.has(handleName)) {
    ipcRenderer.removeAllListeners(handleName);
  }

  xpcHandlers.set(handleName, handler);

  // Notify main process about this registration
  ipcRenderer.send(XPC_REGISTER, { handleName });

  // Listen for incoming handleName events forwarded by xpcCenter
  ipcRenderer.on(handleName, async (_event, payload: XpcPayload) => {
    let ret: any = null;
    const localHandler = xpcHandlers.get(handleName);
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
};

/**
 * Remove a registered handler.
 */
const removeHandle = (handleName: string): void => {
  xpcHandlers.delete(handleName);
  ipcRenderer.removeAllListeners(handleName);
};

/**
 * Send a message to another renderer (or any registered handler) via main process.
 * Uses ipcRenderer.invoke(__xpc_exec__) which blocks until the target finishes.
 * Returns the ret value from the target handler, or null.
 */
const send = async (handleName: string, params?: any): Promise<any> => {
  const payload: XpcPayload = {
    id: generateXpcId(),
    handleName,
    params,
    ret: null,
  };

  return await ipcRenderer.invoke(XPC_EXEC, payload);
};

/**
 * Returns a contextBridge-safe object for exposeInMainWorld.
 */
const createXpcRendererApi = (): XpcRendererApi => {
  return {
    handle: (handleName: string, handler: (payload: XpcPayload) => Promise<any>): void => {
      handle(handleName, handler);
    },
    removeHandle: (handleName: string): void => {
      removeHandle(handleName);
    },
    send: (handleName: string, params?: any): Promise<any> => {
      return send(handleName, params);
    },
  };
};

/** The xpcRenderer API instance */
export const xpcRenderer: XpcRendererApi = createXpcRendererApi();

// Auto-expose xpcRenderer to window on import
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('xpcRenderer', xpcRenderer);
  } catch (error) {
    console.error('[xpcPreload] exposeInMainWorld failed:', error);
  }
} else {
  (globalThis as any).xpcRenderer = xpcRenderer;
}
