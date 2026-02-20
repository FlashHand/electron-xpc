/* Node.js globals used by electron-xpc */

declare const console: {
  log(...args: any[]): void;
  error(...args: any[]): void;
  warn(...args: any[]): void;
};

declare const process: {
  contextIsolated: boolean;
  platform: string;
  env: Record<string, string | undefined>;
};

declare const globalThis: typeof global & Record<string, any>;
