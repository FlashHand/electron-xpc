import { buildXpcChannel, XpcEmitterOf } from '../shared/xpcHandler.type';
import { xpcRenderer } from './xpcPreload.helper';

/**
 * Create a type-safe emitter proxy for a preload-process xpc handler.
 * The emitter mirrors the handler's method signatures, but each call
 * sends a message via xpcRenderer.send() to `xpc:ClassName/methodName`.
 *
 * CRITICAL: Always use `import type` to avoid importing actual handler implementation
 * and its dependencies (e.g., electron main modules) into the preload process.
 *
 * Example:
 * ```ts
 * // In main process:
 * class UserService extends XpcMainHandler {
 *   async getUserList(params?: any): Promise<any> { ... }
 * }
 *
 * // In preload process:
 * import type { UserService } from '@main/userService.handler'; // ← type-only import!
 * const userEmitter = createXpcPreloadEmitter<UserService>('UserService');
 * const list = await userEmitter.getUserList({ page: 1 });
 * // sends to 'xpc:UserService/getUserList'
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
