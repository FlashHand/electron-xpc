import { buildXpcChannel, XpcEmitterOf } from '../shared/xpcHandler.type';
import { xpcRenderer } from './xpcPreload.helper';

/**
 * Create a type-safe emitter proxy for a preload-process xpc handler.
 * The emitter mirrors the handler's method signatures, but each call
 * sends a message via xpcRenderer.send() to `xpc:ClassName/methodName`.
 *
 * Example:
 * ```ts
 * class UserTable extends XpcPreloadHandler {
 *   async getUserList(params?: any): Promise<any> { ... }
 * }
 * const userTableEmitter = createXpcPreloadEmitter<UserTable>('UserTable');
 * const list = await userTableEmitter.getUserList({ page: 1 });
 * // sends to 'xpc:UserTable/getUserList'
 * ```
 */
export const createXpcPreloadEmitter = <T>(className: string): XpcEmitterOf<T> => {
  return new Proxy({} as XpcEmitterOf<T>, {
    get(_target, prop: string) {
      const channel = buildXpcChannel(className, prop);
      return (params?: any) => xpcRenderer.send(channel, params);
    },
  });
};
