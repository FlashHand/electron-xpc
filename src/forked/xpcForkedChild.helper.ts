import { XpcPayload } from '../shared/xpc.type';
import { generateXpcId } from '../main/xpcId.helper';
import { XpcForkTask } from './xpcForkTask.helper';

const FORK_FINISH = '__fork_finish__';

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
export class XpcForkedChild {
  private pendingTasks = new Map<string, XpcForkTask>();

  constructor() {
    this.setupListeners();
  }

  /**
   * Invoke a handle registered in the parent process.
   * Blocks until the parent responds via __fork_finish__.
   */
  async invoke(handleName: string, payload?: any): Promise<any> {
    const id = generateXpcId();

    const task = new XpcForkTask({ id, handleName, params: payload });
    this.pendingTasks.set(id, task);

    const message: XpcPayload = {
      id,
      handleName,
      params: payload,
    };

    (process as unknown as NodeJS.Process).send!(message, undefined, {}, (err: Error | null) => {
      if (err) {
        console.error(`[XpcForkedChild] Failed to send for "${handleName}":`, err);
        const t = this.pendingTasks.get(id);
        if (t) {
          t.unblock();
        }
      }
    });

    await task.block();
    this.pendingTasks.delete(id);

    return task.ret;
  }

  private setupListeners(): void {
    (process as unknown as NodeJS.Process).on('message', (message: any) => {
      if (!message || message.__fork_event__ !== FORK_FINISH) return;

      const payload = message.payload as XpcPayload;
      const task = this.pendingTasks.get(payload.id);
      if (task) {
        task.ret = payload.ret ?? null;
        task.unblock();
      }
    });
  }
}
