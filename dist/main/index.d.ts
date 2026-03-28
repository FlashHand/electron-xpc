import { MessagePortMain } from 'electron';

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

interface SubscriberEntry {
    type: 'main' | 'renderer' | 'port';
    id: number | string;
}
/**
 * XpcCenter: runs in the main process.
 * - Listens for __xpc_register__: renderer registers a handleName, center stores {handleName → webContentsId}
 * - Listens for __xpc_exec__ (ipcMain.handle): renderer invokes exec, center forwards to target renderer or utility process,
 *   blocks via semaphore until __xpc_finish__ is received, then returns result.
 * - Listens for __xpc_finish__: target renderer/utility finished execution, unblocks the pending task.
 */
declare class XpcCenter {
    /** handleName → RegistryEntry */
    private registry;
    /** port_id → MessagePortMain */
    private port2Map;
    /** task.id → XpcTask (with semaphore block/unblock) */
    private pendingTasks;
    /** handleName → SubscriberEntry[] */
    private subscribers;
    /** main-process subscriber callbacks: handleName → callback */
    private mainSubscriberCallbacks;
    init(): void;
    /**
     * Register a main-process handleName in the registry with webContentsId = 0.
     */
    registerMainHandler(handleName: string): void;
    /**
     * Register a utility process port handler.
     * @param handleName - The handler name
     * @param port2 - The MessagePort for communication
     * @returns The generated port_id
     */
    registerPortHandler(handleName: string, port2: MessagePortMain): string;
    /**
     * Handle finish message from utility process.
     * Called by xpcMain when utility process sends XPC_FINISH.
     */
    handleUtilityFinish(payload: XpcPayload): void;
    /**
     * Execute a handleName: if main-process handler, call directly;
     * otherwise forward to target renderer or utility process, block until __xpc_finish__.
     * Used by both ipcMain.handle(XPC_EXEC) and xpcMain.send().
     */
    exec(handleName: string, params?: any): Promise<any>;
    /**
     * Find the portId for a given MessagePortMain instance.
     * Returns undefined if not found.
     */
    findPortId(port: MessagePortMain): string | undefined;
    /**
     * Add a subscriber for a handleName. Prevents duplicate entries.
     */
    addSubscriber(handleName: string, entry: SubscriberEntry): void;
    /**
     * Register a main-process subscriber callback.
     */
    registerMainSubscriber(handleName: string, callback: (payload: XpcPayload) => void): void;
    /**
     * Broadcast to all subscribers of a handleName, excluding the sender.
     * Fire-and-forget: does not wait for subscriber responses.
     */
    broadcast(handleName: string, params: any, sender: SubscriberEntry): void;
    private setupListeners;
}
declare const xpcCenter: XpcCenter;

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
    /**
     * Subscribe to a handleName in the main process.
     * The callback will be invoked when another process broadcasts to this handleName.
     */
    subscribe(handleName: string, callback: (payload: XpcPayload) => void): void;
    /**
     * Broadcast to all subscribers of a handleName, excluding the main process (self).
     * Fire-and-forget: does not wait for subscriber responses.
     */
    broadcast(handleName: string, params?: any): void;
}
declare const xpcMain: XpcMain;
interface UtilityProcessOptions {
    modulePath: string;
    args?: string[];
    env?: Record<string, string>;
    execArgv?: string[];
    serviceName?: string;
}
interface XpcUtilityProcess {
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
declare function createUtilityProcess(options: UtilityProcessOptions): XpcUtilityProcess;

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
 * Methods are ignored if:
 * 1. Name starts with `_` or `$` (private method convention)
 * 2. Marked with @xpcIgnore decorator
 *
 * Example:
 * ```ts
 * // In main process — register handler:
 * class UserTable extends XpcMainHandler {
 *   async getUserList(params?: any): Promise<any> { ... } // registered
 *
 *   async _helperMethod(): Promise<void> { ... } // NOT registered
 *
 *   @xpcIgnore
 *   async internalMethod(): Promise<void> { ... } // NOT registered
 * }
 * const userTable = new UserTable();
 *
 * // In renderer process — call via emitter:
 * import type { UserTable } from '@main/userTable.handler';
 * const emitter = createXpcRendererEmitter<UserTable>('UserTable');
 * const list = await emitter.getUserList({ page: 1 });
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
 * Filters out keys that start with `_` or `$` (private method convention).
 */
type ExcludePrivateKeys<K> = K extends `_${string}` | `$${string}` ? never : K;
/**
 * Utility type: extracts the method signatures from a handler class,
 * turning each method into an emitter-compatible signature.
 * Methods with 2+ parameters are mapped to `never`, causing a compile error on use.
 * Methods with `_` or `$` prefix are excluded from the emitter type.
 * Methods marked with @xpcIgnore are excluded at runtime; use `_`/`$` prefix
 * to also exclude them from the type-level emitter.
 */
type XpcEmitterOf<T> = {
    [K in keyof T as T[K] extends (...args: any[]) => any ? ExcludePrivateKeys<K> : never]: AssertSingleParam<T[K]> extends never ? never : T[K] extends (params: infer P) => any ? Parameters<T[K]>['length'] extends 0 ? () => Promise<any> : (params: P) => Promise<any> : () => Promise<any>;
};

/**
 * Create a type-safe emitter proxy for a main-process xpc handler.
 * The emitter mirrors the handler's method signatures, but each call
 * sends a message via xpcMain.send() to `xpc:ClassName/methodName`.
 *
 * CRITICAL: Always use `import type` to avoid importing actual handler implementation
 * and its dependencies (e.g., sqlite, node-only modules) into the main process.
 *
 * Example:
 * ```ts
 * // In preload process:
 * class MessageTable extends XpcPreloadHandler {
 *   async getMessageList(params?: any): Promise<any> { ... }
 * }
 *
 * // In main process:
 * import type { MessageTable } from '@preload/messageTable.handler'; // ← type-only import!
 * const messageEmitter = createXpcMainEmitter<MessageTable>('MessageTable');
 * const messages = await messageEmitter.getMessageList({ chatId: '123' });
 * // sends to 'xpc:MessageTable/getMessageList'
 * ```
 */
declare const createXpcMainEmitter: <T>(className: string) => XpcEmitterOf<T>;

/**
 * Decorator to mark a method as ignored for xpc handler auto-registration.
 *
 * Usage:
 * ```ts
 * class UserService extends XpcMainHandler {
 *   async getUserList(): Promise<any> { ... } // will be registered
 *
 *   @xpcIgnore
 *   async helperMethod(): Promise<void> { ... } // will NOT be registered
 * }
 * ```
 */
declare const xpcIgnore: (target: any, propertyKey: string) => void;

export { type SubscriberEntry, type UtilityProcessOptions, type XpcEmitterOf, XpcMainHandler, type XpcPayload, XpcTask, type XpcUtilityProcess, createUtilityProcess, createXpcMainEmitter, xpcCenter, xpcIgnore, xpcMain };
