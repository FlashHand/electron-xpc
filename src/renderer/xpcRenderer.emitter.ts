import { buildXpcChannel, XpcEmitterOf } from '../shared/xpcHandler.type';
import { xpcRenderer } from './xpcRenderer.helper';

/**
 * Create a type-safe emitter proxy for a renderer-process xpc handler.
 * The emitter mirrors the handler's method signatures, but each call
 * sends a message via xpcRenderer.send() to `xpc:ClassName/methodName`.
 *
 * CRITICAL: Always use `import type` to avoid importing actual handler implementation
 * and its dependencies (e.g., node-only modules) into the renderer process.
 *
 * Example:
 * ```ts
 * // In main process:
 * class UserTable extends XpcMainHandler {
 *   async getUserList(params?: any): Promise<any> { ... }
 * }
 *
 * // In renderer process:
 * import type { UserTable } from '@main/userTable.handler'; // ← type-only import!
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
