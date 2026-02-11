type XpcPayload = {
    /** Unique task ID, guaranteed unique within process lifetime */
    id: string;
    /** Event handle name */
    handleName: string;
    /** Parameters, nullable */
    params?: any;
    /** Return data from target process, nullable, defaults to null */
    ret?: any;
};

type XpcHandler = (payload: XpcPayload) => Promise<any>;
/**
 * XpcRenderer: runs in the renderer process (via preload).
 * - register({handleName}): registers a handleName with main process, also sets up local listener
 * - handle(handleName, handler): registers handler locally + sends __xpc_register__ to main
 * - send(handleName, params): invokes __xpc_exec__ on main, awaits result via ipcRenderer.invoke
 */
declare class XpcRenderer {
    private handlers;
    /**
     * Register a handleName with the main process and bind a local async handler.
     * When another renderer calls send() with this handleName, xpcCenter will forward
     * the payload to this renderer, the handler executes, and result is sent back via __xpc_finish__.
     */
    handle(handleName: string, handler: XpcHandler): void;
    /**
     * Remove a registered handler.
     */
    removeHandle(handleName: string): void;
    /**
     * Send a message to another renderer (or any registered handler) via main process.
     * Uses ipcRenderer.invoke(__xpc_exec__) which blocks until the target finishes.
     * Returns the ret value from the target handler, or null.
     */
    send(handleName: string, params?: any): Promise<any>;
}
declare const xpcRenderer: XpcRenderer;
type XpcRendererApi = {
    handle: (handleName: string, handler: (payload: XpcPayload) => Promise<any>) => void;
    removeHandle: (handleName: string) => void;
    send: (handleName: string, params?: any) => Promise<any>;
};
/**
 * Returns a contextBridge-safe object for exposeInMainWorld.
 * Usage: contextBridge.exposeInMainWorld('xpcRenderer', exposeXpcRenderer())
 */
declare const exposeXpcRenderer: () => XpcRendererApi;

export { type XpcPayload, type XpcRendererApi, exposeXpcRenderer, xpcRenderer };
