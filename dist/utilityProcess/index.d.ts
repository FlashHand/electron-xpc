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
interface XpcUtilityProcessApi {
    handle: (handleName: string, handler: (payload: XpcPayload) => Promise<any>) => void;
    removeHandle: (handleName: string) => void;
    send: (handleName: string, params?: any) => Promise<any>;
}
/**
 * XpcUtilityProcess: runs in utility process.
 * Uses MessagePort for communication with main process.
 * Implements promisified send() using semaphore for async/await support.
 */
declare class XpcUtilityProcess implements XpcUtilityProcessApi {
    private port;
    private handlers;
    private pendingTasks;
    private pendingHandlers;
    /**
     * Initialize with a MessagePort from the main process.
     * Must be called before using handle() or send().
     */
    init(port: any): void;
    /**
     * Register a handler for incoming messages with the given handleName.
     * When main process sends a message to this handleName, the handler executes
     * and the result is sent back via __xpc_finish__.
     */
    handle(handleName: string, handler: XpcHandler): void;
    private registerHandler;
    /**
     * Remove a registered handler.
     */
    removeHandle(handleName: string): void;
    /**
     * Send a message to main process (or another registered handler) via MessagePort.
     * Uses semaphore to block until the target finishes and returns the result.
     * Returns the ret value from the target handler, or null.
     */
    send(handleName: string, params?: any): Promise<any>;
    private setupListeners;
}
declare const xpcUtilityProcess: XpcUtilityProcess;

export { type XpcPayload, type XpcUtilityProcessApi, xpcUtilityProcess };
