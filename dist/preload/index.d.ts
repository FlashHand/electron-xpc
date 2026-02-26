type XpcPayload = {
    /** Unique task ID, guaranteed unique within process lifetime */
    id: string;
    /** Event handle name */
    handleName: string;
    /** Parameters, nullable */
    params?: any;
    /** Return data from target process, nullable, defaults to null */
    ret?: any;
};
type XpcRendererApi = {
    handle: (handleName: string, handler: (payload: XpcPayload) => Promise<any>) => void;
    removeHandle: (handleName: string) => void;
    send: (handleName: string, params?: any) => Promise<any>;
};

type XpcHandler = (payload: XpcPayload) => Promise<any>;
/** Global handlers map, extracted from XpcRenderer class */
declare const xpcHandlers: Map<string, XpcHandler>;

/** The xpcRenderer API instance */
declare const xpcRenderer: XpcRendererApi;

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
declare class XpcPreloadHandler {
    constructor();
}

/**
 * Helper: checks if a function type has at most 1 parameter.
 * Returns the function type itself if valid, `never` otherwise.
 * Uses Parameters<> length check to avoid contravariance issues
 * where (p: any) => any extends () => any in TypeScript.
 */
type AssertSingleParam<F> = F extends (...args: any[]) => any ? Parameters<F>['length'] extends 0 | 1 ? F : never : never;
/**
 * Filters out keys that start with `_` or `$` (private method convention).
 */
type ExcludePrivateKeys<K> = K extends `_${string}` | `$${string}` ? never : K;
/**
 * Utility type: extracts the method signatures from a handler class,
 * turning each method into an emitter-compatible signature.
 * Methods with 2+ parameters are mapped to `never`, causing a compile error on use.
 * Methods with `_` or `$` prefix are excluded from the emitter type.
 * Methods marked with @xpcIgnore are excluded at runtime; use `_`/`$` prefix
 * to also exclude them from the type-level emitter.
 */
type XpcEmitterOf<T> = {
    [K in keyof T as T[K] extends (...args: any[]) => any ? ExcludePrivateKeys<K> : never]: AssertSingleParam<T[K]> extends never ? never : T[K] extends (params: infer P) => any ? Parameters<T[K]>['length'] extends 0 ? () => Promise<any> : (params: P) => Promise<any> : () => Promise<any>;
};

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
declare const createXpcPreloadEmitter: <T>(className: string) => XpcEmitterOf<T>;

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
declare const xpcIgnore: (target: any, propertyKey: string) => void;

export { type XpcEmitterOf, type XpcPayload, XpcPreloadHandler, type XpcRendererApi, createXpcPreloadEmitter, xpcHandlers, xpcIgnore, xpcRenderer };
