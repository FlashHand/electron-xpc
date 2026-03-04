import { fork, ChildProcess } from 'child_process';
import { XpcPayload } from '../shared/xpc.type';

const FORK_FINISH = '__fork_finish__';

type ForkHandler = (params?: any) => Promise<any>;

/**
 * XpcForkedParent: runs in the main (Electron main) process.
 * - Forks a child process at initialization.
 * - handle(): register a named handler that the child can invoke.
 * - When the child sends __fork_exec__, the parent looks up the handler,
 *   executes it, and sends __fork_finish__ back with the result.
 *
 * Usage:
 * ```ts
 * const parent = new XpcForkedParent('/path/to/child.js');
 * parent.handle('myHandle', async (params) => {
 *   return { result: 'hello' };
 * });
 * ```
 */
export class XpcForkedParent {
  readonly child: ChildProcess;

  private handlers = new Map<string, ForkHandler>();

  constructor(scriptPath: string) {
    this.child = fork(scriptPath);
    this.setupListeners();
  }

  /**
   * Register a handler callable by the child process via invoke().
   */
  handle(handleName: string, handler: ForkHandler): void {
    this.handlers.set(handleName, handler);
  }

  private setupListeners(): void {
    this.child.on('message', async (message: any) => {
      if (!message) return;

      const payload = message as XpcPayload;
      if (!payload.id || !payload.handleName) return;

      const { id, handleName, params } = payload;

      const handler = this.handlers.get(handleName);
      let ret: any = null;

      if (handler) {
        try {
          ret = await handler(params) ?? null;
        } catch (err) {
          console.error(`[XpcForkedParent] Handler "${handleName}" threw:`, err);
          ret = null;
        }
      } else {
        console.warn(`[XpcForkedParent] No handler registered for "${handleName}"`);
      }

      const finishMessage = {
        __fork_event__: FORK_FINISH,
        payload: {
          id,
          handleName,
          ret,
        } as XpcPayload,
      };

      if (this.child.connected) {
        this.child.send(finishMessage);
      }
    });
  }
}
