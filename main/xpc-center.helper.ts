import { ipcMain, webContents } from 'electron';
import { XpcPayload } from '../shared/xpc.type';
import { XpcTask } from './xpc-task.helper';

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

  constructor() {
    this.setupListeners();
  }

  private setupListeners(): void {
    // Renderer registers a handleName
    ipcMain.on(XPC_REGISTER, (event, payload: { handleName: string }) => {
      this.registry.set(payload.handleName, event.sender.id);
    });

    // Renderer invokes exec: forward to target renderer, block until finish
    ipcMain.handle(XPC_EXEC, async (_event, payload: XpcPayload): Promise<any> => {
      const targetId = this.registry.get(payload.handleName);
      if (targetId == null) {
        return null;
      }

      const target = webContents.fromId(targetId);
      if (!target) {
        return null;
      }

      // Create semaphore-blocked task
      const task = new XpcTask(payload);

      this.pendingTasks.set(task.id, task);

      // Forward handleName event + payload to target renderer
      target.send(payload.handleName, payload);

      // Block until __xpc_finish__ unblocks
      await task.block();
      this.pendingTasks.delete(task.id);

      return task.toPayload().ret ?? null;
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
