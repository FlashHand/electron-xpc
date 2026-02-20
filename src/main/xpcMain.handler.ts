import { XpcPayload } from '../shared/xpc.type';
import { buildXpcChannel, getHandlerMethodNames } from '../shared/xpcHandler.type';
import { xpcMain } from './xpcMain.helper';

/**
 * Base class for main-process xpc handlers.
 * Subclass this and define async methods — they will be auto-registered
 * as xpc handlers with channel `xpc:ClassName/methodName`.
 *
 * Example:
 * ```ts
 * class UserTable extends XpcMainHandler {
 *   async getUserList(params?: any): Promise<any> { ... }
 * }
 * const userTable = new UserTable();
 * // auto-registers handler for 'xpc:UserTable/getUserList'
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
