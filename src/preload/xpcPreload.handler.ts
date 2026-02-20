import { XpcPayload } from '../shared/xpc.type';
import { buildXpcChannel, getHandlerMethodNames } from '../shared/xpcHandler.type';
import { xpcRenderer } from './xpcPreload.helper';

/**
 * Base class for preload-process xpc handlers.
 * Subclass this and define async methods — they will be auto-registered
 * as xpc handlers with channel `xpc:ClassName/methodName`.
 *
 * Example:
 * ```ts
 * class UserTable extends XpcPreloadHandler {
 *   async getUserList(params?: any): Promise<any> { ... }
 * }
 * const userTable = new UserTable();
 * // auto-registers handler for 'xpc:UserTable/getUserList'
 * ```
 */
export class XpcPreloadHandler {
  constructor() {
    const className = this.constructor.name;
    const methodNames = getHandlerMethodNames(Object.getPrototypeOf(this));
    for (const methodName of methodNames) {
      const channel = buildXpcChannel(className, methodName);
      const method = (this as any)[methodName].bind(this);
      xpcRenderer.handle(channel, async (payload: XpcPayload) => {
        return await method(payload.params);
      });
    }
  }
}
