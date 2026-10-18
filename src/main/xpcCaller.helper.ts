import { AsyncLocalStorage } from 'node:async_hooks';
import type { IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron';

/**
 * Who called the main-process handler that is running now. This is only the most recent hop: a renderer
 * that calls main handler A, which calls handler B through xpcMain.send(), makes B see `main`.
 * - `renderer`: from the invoke event. `processId`, `frameId`, `origin` and `url` are copied when the call
 *   arrives and identify the calling document. `frame` is Electron's live WebFrameMain: it follows the frame
 *   to whatever document it shows later (and is null if the frame was already gone), so use it to talk to the
 *   frame, not to identify the caller.
 * - `main`: `xpcMain.send()` from the main process
 * - `utility`: a utility process's `send()`. `portId` is an opaque id, stable for that process's lifetime
 */
export type XpcCaller =
  | {
      type: 'renderer';
      webContents: WebContents;
      frame: WebFrameMain | null;
      processId: number;
      frameId: number;
      origin: string;
      url: string;
    }
  | { type: 'main' }
  | { type: 'utility'; portId: string };

// One context per handler call. AsyncLocalStorage follows the call across awaits and never leaks into
// a concurrent call, which a module-level "current caller" variable would.
const storage = new AsyncLocalStorage<XpcCaller>();

/** Runs a main-process handler with its caller attached. Used by xpcCenter only. */
export const runWithXpcCaller = <T>(caller: XpcCaller, run: () => T): T => storage.run(caller, run);

// A WebFrameMain whose render frame is gone throws on property access.
const readFrame = (frame: WebFrameMain | null, key: 'origin' | 'url'): string => {
  if (!frame) return '';
  try {
    return frame[key];
  } catch {
    return '';
  }
};

/** The caller of a renderer invoke, captured at arrival. Used by xpcCenter only. */
export const createRendererCaller = (event: IpcMainInvokeEvent): XpcCaller => {
  const frame = event.senderFrame ?? null;
  return {
    type: 'renderer',
    webContents: event.sender,
    frame,
    processId: event.processId,
    frameId: event.frameId,
    origin: readFrame(frame, 'origin'),
    url: readFrame(frame, 'url'),
  };
};

/**
 * The caller of the main-process handler this code runs inside, or `undefined` outside a handler call.
 * Works synchronously and after awaits within the same call. Code the handler calls directly (a method call,
 * `xpcMain.getHandler(name)(payload)`, a main subscriber fired by `xpcMain.broadcast()`) sees the same caller,
 * and timers or loops started inside a handler keep seeing it after the handler returns — so read it at handler
 * entry and pass it on explicitly.
 */
export const getXpcCaller = (): XpcCaller | undefined => storage.getStore();

/**
 * True only when the call was sent by the frame that is now the main frame of `webContents`: the ids recorded
 * when the call arrived are compared with `webContents.mainFrame`, so a call from a document the frame has
 * since navigated away from (to another process) is refused. A same-site navigation can keep the frame, so it
 * does not tell those documents apart: pin `caller.url` (or `caller.origin`) when the page may navigate, and
 * note that a same-origin iframe or popup can send through the main frame's preload API. Never throws; anything
 * unreadable is `false`.
 */
export const isMainFrameCaller = (caller: XpcCaller | undefined, webContents: WebContents | null | undefined): boolean => {
  if (!caller || caller.type !== 'renderer' || !caller.frame || !webContents) return false;
  try {
    if (webContents.isDestroyed() || caller.webContents.isDestroyed()) return false;
    if (caller.webContents.id !== webContents.id) return false;
    if (!Number.isInteger(caller.processId) || !Number.isInteger(caller.frameId)) return false;
    const mainFrame = webContents.mainFrame;
    return caller.processId === mainFrame.processId && caller.frameId === mainFrame.routingId;
  } catch {
    return false;
  }
};
