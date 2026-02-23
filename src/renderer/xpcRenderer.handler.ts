import { XpcPayload } from '../shared/xpc.type';
import { buildXpcChannel, getHandlerMethodNames } from '../shared/xpcHandler.type';
import { xpcRenderer } from './xpcRenderer.helper';

/**
 * Base class for renderer-process xpc handlers.
 * Subclass this and define async methods — they will be auto-registered
 * as xpc handlers with channel `xpc:ClassName/methodName`.
 *
 * Methods are ignored if:
 * 1. Name starts with `_` or `$` (private method convention)
 * 2. Marked with @xpcIgnore decorator
 *
 * Example:
 * ```ts
 * // In renderer process — register handler:
 * class UINotification extends XpcRendererHandler {
 *   async showToast(params?: any): Promise<void> { ... } // registered
 *   
 *   async _helperMethod(): Promise<void> { ... } // NOT registered
 *   
 *   @xpcIgnore
 *   async internalMethod(): Promise<void> { ... } // NOT registered
 * }
 * const uiNotification = new UINotification();
 *
 * // In preload process — call via emitter:
 * import type { UINotification } from '@renderer/uiNotification.handler';
 * const emitter = createXpcPreloadEmitter<UINotification>('UINotification');
 * await emitter.showToast({ text: 'Hello!' });
 * ```
 */
export class XpcRendererHandler {
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
