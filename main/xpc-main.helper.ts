import { BrowserWindow, ipcMain } from 'electron';
import { XpcPayload } from '../shared/xpc.type';
import { XpcTask } from './xpc-task.helper';
import { generateXpcId } from './xpc-id.helper';

const XPC_FINISH = '__xpc_finish__';

/**
 * XpcMain: runs in the main process.
 * Sends messages to a specific renderer window and awaits the response.
 * Uses Semaphore to block until __xpc_finish__ is received from the target renderer.
 */
class XpcMain {
  private pendingTasks = new Map<string, XpcTask>();

  constructor() {
    this.setupFinishListener();
  }

  private setupFinishListener(): void {
    ipcMain.on(XPC_FINISH, (_event, payload: XpcPayload) => {
      const task = this.pendingTasks.get(payload.id);
      if (task) {
        task.ret = payload.ret ?? null;
        task.unblock();
      }
    });
  }

  /**
   * Send a message to a specific renderer window and await the response.
   * The target renderer must have registered the handleName via xpcRenderer.handle().
   */
  async sendToRenderer(
    win: BrowserWindow,
    handleName: string,
    params?: any
  ): Promise<any> {
    const task = new XpcTask({
      id: generateXpcId(),
      handleName,
      params,
    });

    this.pendingTasks.set(task.id, task);

    // Send handleName event + payload to target renderer
    win.webContents.send(handleName, task.toPayload());

    // Block until __xpc_finish__
    await task.block();
    this.pendingTasks.delete(task.id);

    return task.toPayload().ret ?? null;
  }
}

export const xpcMain = new XpcMain();
