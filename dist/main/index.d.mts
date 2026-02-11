import { BrowserWindow } from 'electron';

/**
 * XpcCenter: runs in the main process.
 * - Listens for __xpc_register__: renderer registers a handleName, center stores {handleName → webContentsId}
 * - Listens for __xpc_exec__ (ipcMain.handle): renderer invokes exec, center forwards to target renderer,
 *   blocks via semaphore until __xpc_finish__ is received, then returns result.
 * - Listens for __xpc_finish__: target renderer finished execution, unblocks the pending task.
 */
declare class XpcCenter {
    /** handleName → webContentsId */
    private registry;
    /** task.id → XpcTask (with semaphore block/unblock) */
    private pendingTasks;
    constructor();
    private setupListeners;
}
declare const xpcCenter: XpcCenter;

/**
 * XpcMain: runs in the main process.
 * Sends messages to a specific renderer window and awaits the response.
 * Uses Semaphore to block until __xpc_finish__ is received from the target renderer.
 */
declare class XpcMain {
    private pendingTasks;
    constructor();
    private setupFinishListener;
    /**
     * Send a message to a specific renderer window and await the response.
     * The target renderer must have registered the handleName via xpcRenderer.handle().
     */
    sendToRenderer(win: BrowserWindow, handleName: string, params?: any): Promise<any>;
}
declare const xpcMain: XpcMain;

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

declare class XpcTask implements XpcPayload {
    id: string;
    handleName: string;
    params?: any;
    ret?: any;
    private semaphore;
    constructor(payload: XpcPayload);
    /** Block until unblock() is called */
    block(): Promise<void>;
    /** Release the semaphore, unblocking the waiting block() call */
    unblock(): void;
    /** Convert to a plain XpcPayload (serializable for IPC) */
    toPayload(): XpcPayload;
}

export { type XpcPayload, XpcTask, xpcCenter, xpcMain };
