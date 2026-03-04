/**
 * XpcForkedChild: runs inside a forked child process.
 * - invoke(): send a request to the parent process and await the result.
 *
 * Usage:
 * ```ts
 * const xpcChild = new XpcForkedChild();
 * const result = await xpcChild.invoke('myHandle', { foo: 'bar' });
 * ```
 */
declare class XpcForkedChild {
    private pendingTasks;
    constructor();
    /**
     * Invoke a handle registered in the parent process.
     * Blocks until the parent responds via __fork_finish__.
     */
    invoke(handleName: string, payload?: any): Promise<any>;
    private setupListeners;
}

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

declare class XpcForkTask implements XpcPayload {
    id: string;
    handleName: string;
    params?: any;
    ret: any;
    private semaphore;
    constructor(payload: XpcPayload);
    /** Block until unblock() is called */
    block(): Promise<void>;
    /** Release the semaphore, unblocking the waiting block() call */
    unblock(): void;
    /** Convert to a plain XpcPayload (serializable for IPC) */
    toPayload(): XpcPayload;
}

export { XpcForkTask, XpcForkedChild };
