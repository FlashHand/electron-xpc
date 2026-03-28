import { Semaphore } from '@rig-lib/semaphore';
import { XpcPayload } from '../shared/xpc.type';
import { generateXpcId } from './xpcId.helper';

const XPC_REGISTER = '__xpc_register__';
const XPC_EXEC = '__xpc_exec__';
const XPC_FINISH = '__xpc_finish__';
const XPC_SUBSCRIBE = '__xpc_subscribe__';
const XPC_BROADCAST = '__xpc_broadcast__';
const XPC_BROADCAST_DISPATCH = '__xpc_broadcast_dispatch__';

type XpcHandler = (payload: XpcPayload) => Promise<any>;

export interface XpcUtilityProcessApi {
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
class XpcUtilityProcess implements XpcUtilityProcessApi {
  private port: any = null; // Electron.MessagePort in utility process
  private handlers = new Map<string, XpcHandler>();
  private pendingTasks = new Map<string, { semaphore: Semaphore; ret: any }>();
  private pendingHandlers: Array<{ handleName: string; handler: XpcHandler }> = [];
  private subscriberCallbacks = new Map<string, (payload: XpcPayload) => void>();
  private pendingSubscribers: Array<{ handleName: string; callback: (payload: XpcPayload) => void }> = [];

  /**
   * Initialize with a MessagePort from the main process.
   * Must be called before using handle() or send().
   */
  init(port: any): void {
    this.port = port;
    this.setupListeners();
    // Must call start() to begin receiving messages on Electron's MessagePort
    this.port.start();
    
    // Register any pending handlers that were called before init
    for (const { handleName, handler } of this.pendingHandlers) {
      this.registerHandler(handleName, handler);
    }
    this.pendingHandlers = [];

    // Register any pending subscribers that were called before init
    for (const { handleName, callback } of this.pendingSubscribers) {
      this.registerSubscriber(handleName, callback);
    }
    this.pendingSubscribers = [];
  }

  /**
   * Register a handler for incoming messages with the given handleName.
   * When main process sends a message to this handleName, the handler executes
   * and the result is sent back via __xpc_finish__.
   */
  handle(handleName: string, handler: XpcHandler): void {
    if (!this.port) {
      // Queue handler registration until port is initialized
      this.pendingHandlers.push({ handleName, handler });
      return;
    }

    this.registerHandler(handleName, handler);
  }

  private registerHandler(handleName: string, handler: XpcHandler): void {
    // Remove existing handler to prevent stacking
    if (this.handlers.has(handleName)) {
      this.handlers.delete(handleName);
    }

    this.handlers.set(handleName, handler);

    // Notify main process about this registration
    this.port?.postMessage({
      type: XPC_REGISTER,
      handleName,
    });
  }

  /**
   * Remove a registered handler.
   */
  removeHandle(handleName: string): void {
    this.handlers.delete(handleName);
  }

  /**
   * Subscribe to a handleName. When another process broadcasts to this handleName,
   * the callback will be invoked with the full XpcPayload.
   */
  subscribe(handleName: string, callback: (payload: XpcPayload) => void): void {
    if (!this.port) {
      this.pendingSubscribers.push({ handleName, callback });
      return;
    }
    this.registerSubscriber(handleName, callback);
  }

  private registerSubscriber(handleName: string, callback: (payload: XpcPayload) => void): void {
    this.subscriberCallbacks.set(handleName, callback);
    this.port?.postMessage({
      type: XPC_SUBSCRIBE,
      handleName,
    });
  }

  /**
   * Broadcast to all subscribers of a handleName, excluding this utility process (self).
   * Fire-and-forget: does not wait for subscriber responses.
   */
  broadcast(handleName: string, params?: any): void {
    if (!this.port) {
      throw new Error('[xpcUtilityProcess] MessagePort not initialized. Call init() first.');
    }

    const payload: XpcPayload = {
      id: generateXpcId(),
      handleName,
      params,
    };

    this.port.postMessage({
      type: XPC_BROADCAST,
      payload,
    });
  }

  /**
   * Send a message to main process (or another registered handler) via MessagePort.
   * Uses semaphore to block until the target finishes and returns the result.
   * Returns the ret value from the target handler, or null.
   */
  async send(handleName: string, params?: any): Promise<any> {
    if (!this.port) {
      throw new Error('[xpcUtilityProcess] MessagePort not initialized. Call init() first.');
    }

    const payload: XpcPayload = {
      id: generateXpcId(),
      handleName,
      params,
      ret: null,
    };

    // Create semaphore for this task
    const semaphore = new Semaphore(1);
    semaphore.take(() => {}); // Take immediately to block

    const taskInfo = { semaphore, ret: null };
    this.pendingTasks.set(payload.id, taskInfo);

    // Send exec message to main process
    this.port.postMessage({
      type: XPC_EXEC,
      payload,
    });

    // Block until __xpc_finish__ is received
    await semaphore.takeAsync();

    // Cleanup and return result
    const result = taskInfo.ret;
    this.pendingTasks.delete(payload.id);

    return result ?? null;
  }

  private setupListeners(): void {
    if (!this.port) return;

    this.port.on('message', async (event: any) => {
      const { type, payload, handleName } = event.data;

      // Handle incoming execution requests
      if (type === 'exec' && handleName) {
        const handler = this.handlers.get(handleName);
        let ret: any = null;

        if (handler && payload) {
          try {
            ret = await handler(payload as XpcPayload);
          } catch (_e) {
            ret = null;
          }
        }

        // Send result back to main process
        this.port?.postMessage({
          type: XPC_FINISH,
          payload: {
            id: payload.id,
            handleName: payload.handleName,
            params: payload.params,
            ret,
          } as XpcPayload,
        });
      }

      // Handle finish responses for our pending send() calls
      if (type === XPC_FINISH && payload) {
        const taskInfo = this.pendingTasks.get(payload.id);
        if (taskInfo) {
          taskInfo.ret = payload.ret ?? null;
          taskInfo.semaphore.leave(); // Unblock the waiting send()
        }
      }

      // Handle broadcast dispatch from main process
      if (type === XPC_BROADCAST_DISPATCH && payload) {
        const cb = this.subscriberCallbacks.get(payload.handleName);
        if (cb) {
          try { cb(payload); } catch (_e) { /* ignore */ }
        }
      }
    });
  }
}

export const xpcUtilityProcess = new XpcUtilityProcess();

// Auto-initialize via process.parentPort (Electron utility process API)
if (typeof process !== 'undefined' && (process as any).parentPort) {
  (process as any).parentPort.on('message', (event: any) => {
    if (event.data?.type === 'xpc:init' && event.ports?.length > 0) {
      xpcUtilityProcess.init(event.ports[0]);
    }
  });
}
