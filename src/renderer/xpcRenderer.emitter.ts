import { buildXpcChannel, XpcEmitterOf } from '../shared/xpcHandler.type';
import { xpcRenderer } from './xpcRenderer.helper';

/**
 * Create a type-safe emitter proxy for a renderer-process xpc handler.
 * The emitter mirrors the handler's method signatures, but each call
 * sends a message via xpcRenderer.send() to `xpc:ClassName/methodName`.
 *
 * Example:
 * ```ts
 * class UserTable extends XpcRendererHandler {
 *   async getUserList(params?: any): Promise<any> { ... }
 * }
 * const userTableEmitter = createXpcRendererEmitter<UserTable>('UserTable');
 * const list = await userTableEmitter.getUserList({ page: 1 });
 * // sends to 'xpc:UserTable/getUserList'
 * ```
 */
export const createXpcRendererEmitter = <T>(className: string): XpcEmitterOf<T> => {
  return new Proxy({} as XpcEmitterOf<T>, {
    get(_target, prop: string) {
      const channel = buildXpcChannel(className, prop);
      return (params?: any) => xpcRenderer.send(channel, params);
    },
  });
};
