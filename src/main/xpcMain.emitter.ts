import { buildXpcChannel, XpcEmitterOf } from '../shared/xpcHandler.type';
import { xpcMain } from './xpcMain.helper';

/**
 * Create a type-safe emitter proxy for a main-process xpc handler.
 * The emitter mirrors the handler's method signatures, but each call
 * sends a message via xpcMain.send() to `xpc:ClassName/methodName`.
 *
 * CRITICAL: Always use `import type` to avoid importing actual handler implementation
 * and its dependencies (e.g., sqlite, node-only modules) into the main process.
 *
 * Example:
 * ```ts
 * // In preload process:
 * class MessageTable extends XpcPreloadHandler {
 *   async getMessageList(params?: any): Promise<any> { ... }
 * }
 *
 * // In main process:
 * import type { MessageTable } from '@preload/messageTable.handler'; // ← type-only import!
 * const messageEmitter = createXpcMainEmitter<MessageTable>('MessageTable');
 * const messages = await messageEmitter.getMessageList({ chatId: '123' });
 * // sends to 'xpc:MessageTable/getMessageList'
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
