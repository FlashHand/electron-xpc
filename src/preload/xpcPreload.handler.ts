import { XpcPayload } from '../shared/xpc.type';
import { buildXpcChannel, getHandlerMethodNames } from '../shared/xpcHandler.type';
import { xpcRenderer } from './xpcPreload.helper';

/**
 * Base class for preload-process xpc handlers.
 * Subclass this and define async methods — they will be auto-registered
 * as xpc handlers with channel `xpc:ClassName/methodName`.
 *
 * Methods are ignored if:
 * 1. Name starts with `_` or `$` (private method convention)
 * 2. Marked with @xpcIgnore decorator
 *
 * Example:
 * ```ts
 * // In preload process — register handler:
 * class MessageTable extends XpcPreloadHandler {
 *   async getMessageList(params?: any): Promise<any> { ... } // registered
 *   
 *   async _helperMethod(): Promise<void> { ... } // NOT registered
 *   
 *   @xpcIgnore
 *   async internalMethod(): Promise<void> { ... } // NOT registered
 * }
 * const messageTable = new MessageTable();
 *
 * // In main process — call via emitter:
 * import type { MessageTable } from '@preload/messageTable.handler';
 * const emitter = createXpcMainEmitter<MessageTable>('MessageTable');
 * const messages = await emitter.getMessageList({ chatId: '123' });
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
