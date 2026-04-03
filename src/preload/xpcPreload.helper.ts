import { contextBridge, ipcRenderer } from 'electron';
import { XpcPayload, XpcRendererApi } from '../shared/xpc.type';
import { generateXpcId } from './xpcId.helper';

const XPC_REGISTER = '__xpc_register__';
const XPC_EXEC = '__xpc_exec__';
const XPC_FINISH = '__xpc_finish__';
const XPC_SUBSCRIBE = '__xpc_subscribe__';
const XPC_BROADCAST = '__xpc_broadcast__';
const XPC_BROADCAST_DISPATCH = '__xpc_broadcast_dispatch__';

type XpcHandler = (payload: XpcPayload) => Promise<any>;

/** Global handlers map, extracted from XpcRenderer class */
export const xpcHandlers = new Map<string, XpcHandler>();

/** Global subscriber callbacks: handleName → callback */
const xpcSubscribers = new Map<string, (payload: XpcPayload) => void>();
let broadcastDispatchListenerSetup = false;

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
      } catch (error) {
        console.error('[xpcPreload.helper] error in', handleName, error);
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
 * Subscribe to a handleName. When another process broadcasts to this handleName,
 * the callback will be invoked with the full XpcPayload.
 */
const subscribe = (handleName: string, callback: (payload: XpcPayload) => void): void => {
  xpcSubscribers.set(handleName, callback);

  // Notify main process about this subscription
  ipcRenderer.send(XPC_SUBSCRIBE, { handleName });

  // Setup broadcast dispatch listener once
  if (!broadcastDispatchListenerSetup) {
    broadcastDispatchListenerSetup = true;
    ipcRenderer.on(XPC_BROADCAST_DISPATCH, (_event, payload: XpcPayload) => {
      const cb = xpcSubscribers.get(payload.handleName);
      if (cb) {
        try { cb(payload); } catch (_e) { /* ignore */ }
      }
    });
  }
};

/**
 * Broadcast to all subscribers of a handleName, excluding this renderer (self).
 * Fire-and-forget: does not wait for subscriber responses.
 */
const broadcast = (handleName: string, params?: any): void => {
  ipcRenderer.send(XPC_BROADCAST, { handleName, params });
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
    subscribe: (handleName: string, callback: (payload: XpcPayload) => void): void => {
      subscribe(handleName, callback);
    },
    broadcast: (handleName: string, params?: any): void => {
      broadcast(handleName, params);
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
