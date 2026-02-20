import { XpcPayload } from '../shared/xpc.type';
import { xpcCenter } from './xpcCenter.helper';

type XpcHandler = (payload: XpcPayload) => Promise<any>;

/**
 * XpcMain: runs in the main process.
 * - handle(): register a handler callable by renderers or other main-process code.
 * - send(): invoke a registered handleName (main-process or renderer), delegating to xpcCenter.
 */
class XpcMain {
  private handlers = new Map<string, XpcHandler>();

  /**
   * Register a handler in the main process.
   * When another renderer calls send() with this handleName, xpcCenter will
   * invoke this handler directly (webContentsId = 0) without forwarding to a renderer.
   */
  handle(handleName: string, handler: XpcHandler): void {
    this.handlers.set(handleName, handler);
    xpcCenter.registerMainHandler(handleName);
  }

  /**
   * Get the registered handler for a given handleName.
   */
  getHandler(handleName: string): XpcHandler | undefined {
    return this.handlers.get(handleName);
  }

  /**
   * Send a message to a registered handler by handleName.
   * Delegates to xpcCenter.exec() which handles both main-process and renderer targets.
   */
  async send(handleName: string, params?: any): Promise<any> {
    return xpcCenter.exec(handleName, params);
  }
}

export const xpcMain = new XpcMain();
