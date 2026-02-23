/**
 * Symbol to mark methods that should not be auto-registered as xpc handlers.
 */
export const XPC_IGNORE = Symbol('xpc:ignore');

/**
 * Decorator to mark a method as ignored for xpc handler auto-registration.
 * 
 * Usage:
 * ```ts
 * class UserService extends XpcMainHandler {
 *   async getUserList(): Promise<any> { ... } // will be registered
 *   
 *   @xpcIgnore
 *   async helperMethod(): Promise<void> { ... } // will NOT be registered
 * }
 * ```
 */
export const xpcIgnore = (target: any, propertyKey: string): void => {
  const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
  if (descriptor && typeof descriptor.value === 'function') {
    descriptor.value[XPC_IGNORE] = true;
  }
};
