import { ipcMain, webContents } from 'electron';
import { XpcPayload } from '../shared/xpc.type';
import { XpcTask } from './xpcTask.helper';
import { generateXpcId } from './xpcId.helper';
import { xpcMain } from './xpcMain.helper';

const XPC_REGISTER = '__xpc_register__';
const XPC_EXEC = '__xpc_exec__';
const XPC_FINISH = '__xpc_finish__';

/**
 * XpcCenter: runs in the main process.
 * - Listens for __xpc_register__: renderer registers a handleName, center stores {handleName → webContentsId}
 * - Listens for __xpc_exec__ (ipcMain.handle): renderer invokes exec, center forwards to target renderer,
 *   blocks via semaphore until __xpc_finish__ is received, then returns result.
 * - Listens for __xpc_finish__: target renderer finished execution, unblocks the pending task.
 */
class XpcCenter {
  /** handleName → webContentsId */
  private registry = new Map<string, number>();
  /** task.id → XpcTask (with semaphore block/unblock) */
  private pendingTasks = new Map<string, XpcTask>();

  init(): void {
    this.setupListeners();
  }

  /**
   * Register a main-process handleName in the registry with webContentsId = 0.
   */
  registerMainHandler(handleName: string): void {
    this.registry.set(handleName, 0);
  }

  /**
   * Execute a handleName: if main-process handler, call directly;
   * otherwise forward to target renderer, block until __xpc_finish__.
   * Used by both ipcMain.handle(XPC_EXEC) and xpcMain.send().
   */
  async exec(handleName: string, params?: any): Promise<any> {
    const targetId = this.registry.get(handleName);
    if (targetId == null) {
      return null;
    }

    const payload: XpcPayload = {
      id: generateXpcId(),
      handleName,
      params,
    };

    // targetId === 0 means the handler is registered in the main process
    if (targetId === 0) {
      const handler = xpcMain.getHandler(handleName);
      if (!handler) {
        return null;
      }
      try {
        return await handler(payload);
      } catch (_e) {
        return null;
      }
    }

    const target = webContents.fromId(targetId);
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

  private setupListeners(): void {
    // Renderer registers a handleName (overwrites previous registration for the same handleName)
    ipcMain.on(XPC_REGISTER, (event, payload: { handleName: string }) => {
      const existingId = this.registry.get(payload.handleName);
      if (existingId != null && existingId !== event.sender.id) {
        console.log(`[xpcCenter] handler "${payload.handleName}" overwritten: webContentsId ${existingId} → ${event.sender.id}`);
      }
      this.registry.set(payload.handleName, event.sender.id);
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
  }
}

export const xpcCenter = new XpcCenter();
