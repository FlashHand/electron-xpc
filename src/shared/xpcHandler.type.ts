/**
 * Prefix for all auto-registered xpc handler channels.
 * Channel format: `xpc:ClassName/methodName`
 */
export const XPC_HANDLER_PREFIX = 'xpc:';

/**
 * Build the xpc channel name from class name and method name.
 * e.g. buildChannel('UserTable', 'getUserList') => 'xpc:UserTable/getUserList'
 */
export const buildXpcChannel = (className: string, methodName: string): string => {
  return `${XPC_HANDLER_PREFIX}${className}/${methodName}`;
};

/**
 * Extract own method names from a class prototype, excluding constructor.
 */
export const getHandlerMethodNames = (prototype: object): string[] => {
  const names: string[] = [];
  const keys = Object.getOwnPropertyNames(prototype);
  for (const key of keys) {
    if (key === 'constructor') continue;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (descriptor && typeof descriptor.value === 'function') {
      names.push(key);
    }
  }
  return names;
};

/**
 * Constraint: handler methods must accept 0 or 1 parameter.
 * Methods with 2+ parameters will fail type checking.
 */
export type XpcHandlerMethod = (() => Promise<any>) | ((params: any) => Promise<any>);

/**
 * Helper: checks if a function type has at most 1 parameter.
 * Returns the function type itself if valid, `never` otherwise.
 * Uses Parameters<> length check to avoid contravariance issues
 * where (p: any) => any extends () => any in TypeScript.
 */
type AssertSingleParam<F> =
  F extends (...args: any[]) => any
    ? Parameters<F>['length'] extends 0 | 1 ? F : never
    : never;

/**
 * Utility type: extracts the method signatures from a handler class,
 * turning each method into an emitter-compatible signature.
 * Methods with 2+ parameters are mapped to `never`, causing a compile error on use.
 */
export type XpcEmitterOf<T> = {
  [K in keyof T as T[K] extends (...args: any[]) => any ? K : never]:
    AssertSingleParam<T[K]> extends never
      ? never
      : T[K] extends (params: infer P) => any
        ? Parameters<T[K]>['length'] extends 0
          ? () => Promise<any>
          : (params: P) => Promise<any>
        : () => Promise<any>;
};
