import { buildXpcChannel, XpcEmitterOf } from '../shared/xpcHandler.type';
import { xpcMain } from './xpcMain.helper';

/**
 * Create a type-safe emitter proxy for a main-process xpc handler.
 * The emitter mirrors the handler's method signatures, but each call
 * sends a message via xpcMain.send() to `xpc:ClassName/methodName`.
 *
 * Example:
 * ```ts
 * class UserTable extends XpcMainHandler {
 *   async getUserList(params?: any): Promise<any> { ... }
 * }
 * const userTableEmitter = createXpcMainEmitter<UserTable>('UserTable');
 * const list = await userTableEmitter.getUserList({ page: 1 });
 * // sends to 'xpc:UserTable/getUserList'
 * ```
 */
export const createXpcMainEmitter = <T>(className: string): XpcEmitterOf<T> => {
  return new Proxy({} as XpcEmitterOf<T>, {
    get(_target, prop: string) {
      const channel = buildXpcChannel(className, prop);
      return (params?: any) => xpcMain.send(channel, params);
    },
  });
};
