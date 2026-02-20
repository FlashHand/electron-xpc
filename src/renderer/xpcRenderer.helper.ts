import type { XpcRendererApi } from '../shared/xpc.type';

/**
 * Direct reference to window.xpcRenderer exposed by the preload script.
 * Import this in renderer (browser) code to use xpcRenderer without manual window casting.
 */
export const xpcRenderer = (globalThis as any).xpcRenderer as XpcRendererApi;

export type { XpcRendererApi, XpcPayload } from '../shared/xpc.type';
