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
    init(): void;
    /**
     * Register a main-process handleName in the registry with webContentsId = 0.
     */
    registerMainHandler(handleName: string): void;
    /**
     * Execute a handleName: if main-process handler, call directly;
     * otherwise forward to target renderer, block until __xpc_finish__.
     * Used by both ipcMain.handle(XPC_EXEC) and xpcMain.send().
     */
    exec(handleName: string, params?: any): Promise<any>;
    private setupListeners;
}
declare const xpcCenter: XpcCenter;

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
 * XpcMain: runs in the main process.
 * - handle(): register a handler callable by renderers or other main-process code.
 * - send(): invoke a registered handleName (main-process or renderer), delegating to xpcCenter.
 */
declare class XpcMain {
    private handlers;
    /**
     * Register a handler in the main process.
     * When another renderer calls send() with this handleName, xpcCenter will
     * invoke this handler directly (webContentsId = 0) without forwarding to a renderer.
     */
    handle(handleName: string, handler: XpcHandler): void;
    /**
     * Get the registered handler for a given handleName.
     */
    getHandler(handleName: string): XpcHandler | undefined;
    /**
     * Send a message to a registered handler by handleName.
     * Delegates to xpcCenter.exec() which handles both main-process and renderer targets.
     */
    send(handleName: string, params?: any): Promise<any>;
}
declare const xpcMain: XpcMain;

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

/**
 * Base class for main-process xpc handlers.
 * Subclass this and define async methods — they will be auto-registered
 * as xpc handlers with channel `xpc:ClassName/methodName`.
 *
 * Example:
 * ```ts
 * class UserTable extends XpcMainHandler {
 *   async getUserList(params?: any): Promise<any> { ... }
 * }
 * const userTable = new UserTable();
 * // auto-registers handler for 'xpc:UserTable/getUserList'
 * ```
 */
declare class XpcMainHandler {
    constructor();
}

/**
 * Helper: checks if a function type has at most 1 parameter.
 * Returns the function type itself if valid, `never` otherwise.
 * Uses Parameters<> length check to avoid contravariance issues
 * where (p: any) => any extends () => any in TypeScript.
 */
type AssertSingleParam<F> = F extends (...args: any[]) => any ? Parameters<F>['length'] extends 0 | 1 ? F : never : never;
/**
 * Utility type: extracts the method signatures from a handler class,
 * turning each method into an emitter-compatible signature.
 * Methods with 2+ parameters are mapped to `never`, causing a compile error on use.
 */
type XpcEmitterOf<T> = {
    [K in keyof T as T[K] extends (...args: any[]) => any ? K : never]: AssertSingleParam<T[K]> extends never ? never : T[K] extends (params: infer P) => any ? Parameters<T[K]>['length'] extends 0 ? () => Promise<any> : (params: P) => Promise<any> : () => Promise<any>;
};

/**
 * Create a type-safe emitter proxy for a main-process xpc handler.
 * The emitter mirrors the handler's method signatures, but each call
 * sends a message via xpcMain.send() to `xpc:ClassName/methodName`.
 *
 * Example:
 * ```ts
 * class UserTable extends XpcMainHandler {
 *   async getUserList(params?: any): Promise<any> { ... }
 * }
 * const userTableEmitter = createXpcMainEmitter<UserTable>('UserTable');
 * const list = await userTableEmitter.getUserList({ page: 1 });
 * // sends to 'xpc:UserTable/getUserList'
 * ```
 */
declare const createXpcMainEmitter: <T>(className: string) => XpcEmitterOf<T>;

export { type XpcEmitterOf, XpcMainHandler, type XpcPayload, XpcTask, createXpcMainEmitter, xpcCenter, xpcMain };
