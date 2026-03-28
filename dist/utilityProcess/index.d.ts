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
    subscribe: (handleName: string, callback: (payload: XpcPayload) => void) => void;
    broadcast: (handleName: string, params?: any) => void;
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
    private subscriberCallbacks;
    private pendingSubscribers;
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
     * Subscribe to a handleName. When another process broadcasts to this handleName,
     * the callback will be invoked with the full XpcPayload.
     */
    subscribe(handleName: string, callback: (payload: XpcPayload) => void): void;
    private registerSubscriber;
    /**
     * Broadcast to all subscribers of a handleName, excluding this utility process (self).
     * Fire-and-forget: does not wait for subscriber responses.
     */
    broadcast(handleName: string, params?: any): void;
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
