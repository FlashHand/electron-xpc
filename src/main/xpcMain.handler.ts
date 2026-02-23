import { XpcPayload } from '../shared/xpc.type';
import { buildXpcChannel, getHandlerMethodNames } from '../shared/xpcHandler.type';
import { xpcMain } from './xpcMain.helper';

/**
 * Base class for main-process xpc handlers.
 * Subclass this and define async methods — they will be auto-registered
 * as xpc handlers with channel `xpc:ClassName/methodName`.
 *
 * Methods are ignored if:
 * 1. Name starts with `_` or `$` (private method convention)
 * 2. Marked with @xpcIgnore decorator
 *
 * Example:
 * ```ts
 * // In main process — register handler:
 * class UserTable extends XpcMainHandler {
 *   async getUserList(params?: any): Promise<any> { ... } // registered
 *   
 *   async _helperMethod(): Promise<void> { ... } // NOT registered
 *   
 *   @xpcIgnore
 *   async internalMethod(): Promise<void> { ... } // NOT registered
 * }
 * const userTable = new UserTable();
 *
 * // In renderer process — call via emitter:
 * import type { UserTable } from '@main/userTable.handler';
 * const emitter = createXpcRendererEmitter<UserTable>('UserTable');
 * const list = await emitter.getUserList({ page: 1 });
 * ```
 */
export class XpcMainHandler {
  constructor() {
    const className = this.constructor.name;
    const methodNames = getHandlerMethodNames(Object.getPrototypeOf(this));
    for (const methodName of methodNames) {
      const channel = buildXpcChannel(className, methodName);
      const method = (this as any)[methodName].bind(this);
      xpcMain.handle(channel, async (payload: XpcPayload) => {
        return await method(payload.params);
      });
    }
  }
}
