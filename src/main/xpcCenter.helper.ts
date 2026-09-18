import { ipcMain, webContents, MessagePortMain } from 'electron';
import { XpcPayload } from '../shared/xpc.type';
import { XpcTask } from './xpcTask.helper';
import { generateXpcId } from './xpcId.helper';
import { xpcMain } from './xpcMain.helper';
import { randomUUID } from 'crypto';

const XPC_REGISTER = '__xpc_register__';
const XPC_EXEC = '__xpc_exec__';
const XPC_FINISH = '__xpc_finish__';
const XPC_SUBSCRIBE = '__xpc_subscribe__';
const XPC_BROADCAST = '__xpc_broadcast__';
const XPC_BROADCAST_DISPATCH = '__xpc_broadcast_dispatch__';

interface RegistryEntry {
  type: 'main' | 'renderer' | 'port';
  id: number | string; // 0 for main, webContentsId for renderer, port_id (uuid) for port
}

export interface SubscriberEntry {
  type: 'main' | 'renderer' | 'port';
  id: number | string; // 0 for main, webContentsId for renderer, port_id (uuid) for port
}

/**
 * XpcCenter: runs in the main process.
 * - Listens for __xpc_register__: renderer registers a handleName, center stores {handleName → webContentsId}
 * - Listens for __xpc_exec__ (ipcMain.handle): renderer invokes exec, center forwards to target renderer or utility process,
 *   blocks via semaphore until __xpc_finish__ is received, then returns result.
 * - Listens for __xpc_finish__: target renderer/utility finished execution, unblocks the pending task.
 */
class XpcCenter {
  /** handleName → RegistryEntry */
  private registry = new Map<string, RegistryEntry>();
  /** port_id → MessagePortMain */
  private port2Map = new Map<string, MessagePortMain>();
  /** MessagePortMain → port_id, reverse of port2Map for O(1) sender identification */
  private portIdByPort = new WeakMap<MessagePortMain, string>();
  /** task.id → XpcTask (with semaphore block/unblock) */
  private pendingTasks = new Map<string, XpcTask>();
  /** handleName → SubscriberEntry[] */
  private subscribers = new Map<string, SubscriberEntry[]>();
  /** main-process subscriber callbacks: handleName → callback */
  private mainSubscriberCallbacks = new Map<string, (payload: XpcPayload) => void>();

  init(): void {
    this.setupListeners();
  }

  /**
   * Register a main-process handleName in the registry with webContentsId = 0.
   */
  registerMainHandler(handleName: string): void {
    this.registry.set(handleName, { type: 'main', id: 0 });
  }

  /**
   * Mint the identity of one utility process, exactly once, at fork time.
   * Must be called before the port starts delivering messages, so that every
   * subsequent register/subscribe/broadcast from that process shares one portId.
   *
   * Identity is deliberately NOT derived from handler registration: a utility
   * process that only broadcasts never registers a handler, and one that
   * registers N handlers must still be a single subscriber identity — otherwise
   * broadcast self-exclusion compares mismatched ids.
   *
   * @param port2 - The main-side MessagePort for this utility process
   * @returns The generated port_id
   */
  registerPort(port2: MessagePortMain): string {
    const existing = this.portIdByPort.get(port2);
    if (existing != null) {
      return existing;
    }
    const portId = randomUUID();
    this.port2Map.set(portId, port2);
    this.portIdByPort.set(port2, portId);
    return portId;
  }

  /**
   * Point a handleName at an already-registered utility process.
   * Records ownership only — it never mints an identity.
   *
   * @param handleName - The handler name
   * @param portId - The port_id returned by registerPort()
   */
  registerPortHandler(handleName: string, portId: string): void {
    this.registry.set(handleName, { type: 'port', id: portId });
  }

  /**
   * Drop every record belonging to one utility process, and settle the tasks
   * that are waiting on it. Called when the child exits (crash included) or is
   * killed; without it, a send() to a dead utility process would post into a
   * closed port and park forever.
   *
   * Scoped strictly to this portId — other utility processes keep their routes.
   * Idempotent, because kill() and the subsequent 'exit' event both call it.
   */
  unregisterPort(portId: string): void {
    const port2 = this.port2Map.get(portId);
    if (port2 != null) {
      this.portIdByPort.delete(port2);
    }
    this.port2Map.delete(portId);

    // Snapshot before mutating: deleting while iterating a Map is unsafe.
    for (const [handleName, entry] of [...this.registry.entries()]) {
      if (entry.type === 'port' && entry.id === portId) {
        this.registry.delete(handleName);
      }
    }

    for (const [handleName, list] of [...this.subscribers.entries()]) {
      const kept = list.filter(sub => !(sub.type === 'port' && sub.id === portId));
      if (kept.length === 0) {
        this.subscribers.delete(handleName);
      } else if (kept.length !== list.length) {
        this.subscribers.set(handleName, kept);
      }
    }

    // Settle callers that will never receive an answer.
    for (const task of [...this.pendingTasks.values()]) {
      if (task.targetPortId === portId) {
        task.ret = null;
        task.unblock();
      }
    }
  }

  /**
   * Handle finish message from utility process.
   * Called by xpcMain when utility process sends XPC_FINISH.
   */
  handleUtilityFinish(payload: XpcPayload): void {
    const task = this.pendingTasks.get(payload.id);
    if (task) {
      task.ret = payload.ret ?? null;
      task.unblock();
    }
  }

  /**
   * Execute a handleName: if main-process handler, call directly;
   * otherwise forward to target renderer or utility process, block until __xpc_finish__.
   * Used by both ipcMain.handle(XPC_EXEC) and xpcMain.send().
   */
  async exec(handleName: string, params?: any): Promise<any> {
    const entry = this.registry.get(handleName);
    if (entry == null) {
      return null;
    }

    const payload: XpcPayload = {
      id: generateXpcId(),
      handleName,
      params,
    };

    // Main process handler
    if (entry.type === 'main') {
      const handler = xpcMain.getHandler(handleName);
      if (!handler) {
        return null;
      }
      try {
        return await handler(payload);
      } catch (error) {
        console.error('[xpcCenter] error in main handler', handleName, error);
        return null;
      }
    }

    // Utility process handler (type: port)
    if (entry.type === 'port') {
      const port2 = this.port2Map.get(entry.id as string);
      if (!port2) {
        return null;
      }

      // Create semaphore-blocked task
      const task = new XpcTask(payload);
      task.targetPortId = entry.id as string;
      this.pendingTasks.set(task.id, task);

      // Forward to utility process via MessagePort
      port2.postMessage({
        type: 'exec',
        handleName,
        payload,
      });

      // Block until __xpc_finish__ unblocks
      await task.block();
      this.pendingTasks.delete(task.id);

      return task.toPayload().ret ?? null;
    }

    // Renderer process handler
    const target = webContents.fromId(entry.id as number);
    if (!target || target.isDestroyed() || target.isCrashed()) {
      return null;
    }

    // Create semaphore-blocked task
    const task = new XpcTask(payload);

    this.pendingTasks.set(task.id, task);

    // Forward handleName event + payload to target renderer
    target.send(handleName, payload);

    // Block until __xpc_finish__ unblocks
    await task.block();
    this.pendingTasks.delete(task.id);

    return task.toPayload().ret ?? null;
  }

  /**
   * Find the portId for a given MessagePortMain instance.
   * Returns undefined if the port was never registered via registerPort().
   */
  findPortId(port: MessagePortMain): string | undefined {
    return this.portIdByPort.get(port);
  }

  /**
   * Add a subscriber for a handleName. Prevents duplicate entries.
   */
  addSubscriber(handleName: string, entry: SubscriberEntry): void {
    let list = this.subscribers.get(handleName);
    if (!list) {
      list = [];
      this.subscribers.set(handleName, list);
    }
    // Prevent duplicate
    const exists = list.some(s => s.type === entry.type && s.id === entry.id);
    if (!exists) {
      list.push(entry);
    }
  }

  /**
   * Register a main-process subscriber callback.
   */
  registerMainSubscriber(handleName: string, callback: (payload: XpcPayload) => void): void {
    this.addSubscriber(handleName, { type: 'main', id: 0 });
  // Overwrite is the intended semantics — it is what keeps a re-subscribing consumer from
  // accumulating listeners, which matters because there is deliberately no unsubscribe().
  // But it is silent, so TWO DIFFERENT consumers on one channel means the earlier one is
  // permanently dead with no error anywhere. Say so at the moment it happens.
  // See docs/issues/duplicate-subscribe-is-silent.md
    if (this.mainSubscriberCallbacks.has(handleName)) {
      console.warn(
        `[xpcCenter] main subscriber for "${handleName}" overwritten — the previous callback will never run again. subscribe() keeps ONE callback per channel; use a relay if several consumers need this channel.`
      );
    }
    this.mainSubscriberCallbacks.set(handleName, callback);
  }

  /**
   * Broadcast to all subscribers of a handleName, excluding the sender.
   * Fire-and-forget: does not wait for subscriber responses.
   */
  broadcast(handleName: string, params: any, sender: SubscriberEntry): void {
    const list = this.subscribers.get(handleName);
    if (!list || list.length === 0) return;

    const payload: XpcPayload = {
      id: generateXpcId(),
      handleName,
      params,
    };

    for (const sub of list) {
      // Skip the sender
      if (sub.type === sender.type && sub.id === sender.id) continue;

      if (sub.type === 'main') {
        const callback = this.mainSubscriberCallbacks.get(handleName);
        if (callback) {
          try { callback(payload); } catch (_e) { /* ignore */ }
        }
      } else if (sub.type === 'renderer') {
        const target = webContents.fromId(sub.id as number);
        if (target && !target.isDestroyed() && !target.isCrashed()) {
          target.send(XPC_BROADCAST_DISPATCH, payload);
        }
      } else if (sub.type === 'port') {
        const port2 = this.port2Map.get(sub.id as string);
        if (port2) {
          port2.postMessage({
            type: XPC_BROADCAST_DISPATCH,
            payload,
          });
        }
      }
    }
  }

  private setupListeners(): void {
    // Renderer registers a handleName (overwrites previous registration for the same handleName)
    ipcMain.on(XPC_REGISTER, (event, payload: { handleName: string }) => {
      const existing = this.registry.get(payload.handleName);
      if (existing != null && !(existing.type === 'renderer' && existing.id === event.sender.id)) {
        console.log(`[xpcCenter] handler "${payload.handleName}" overwritten: ${existing.type}:${existing.id} → renderer:${event.sender.id}`);
      }
      this.registry.set(payload.handleName, { type: 'renderer', id: event.sender.id });
    });

    // Renderer invokes exec via IPC
    ipcMain.handle(XPC_EXEC, async (_event, payload: XpcPayload): Promise<any> => {
      return this.exec(payload.handleName, payload.params);
    });

    // Target renderer finished execution, unblock pending task
    ipcMain.on(XPC_FINISH, (_event, payload: XpcPayload) => {
      const task = this.pendingTasks.get(payload.id);
      if (task) {
        task.ret = payload.ret ?? null;
        task.unblock();
      }
    });

    // Renderer subscribes to a handleName
    ipcMain.on(XPC_SUBSCRIBE, (event, payload: { handleName: string }) => {
      this.addSubscriber(payload.handleName, { type: 'renderer', id: event.sender.id });
    });

    // Renderer requests broadcast
    ipcMain.on(XPC_BROADCAST, (event, payload: { handleName: string; params?: any }) => {
      this.broadcast(payload.handleName, payload.params, { type: 'renderer', id: event.sender.id });
    });
  }
}

export const xpcCenter = new XpcCenter();
