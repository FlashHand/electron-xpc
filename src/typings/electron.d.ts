declare module 'electron' {
  export interface WebContents {
    id: number;
    isDestroyed(): boolean;
    isCrashed(): boolean;
    send(channel: string, ...args: any[]): void;
  }

  export interface IpcMainEvent {
    sender: WebContents;
  }

  export interface IpcRendererEvent {
    sender: any;
  }

  export const ipcMain: {
    on(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): void;
    handle(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => Promise<any> | any): void;
  };

  export const ipcRenderer: {
    on(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): void;
    send(channel: string, ...args: any[]): void;
    invoke(channel: string, ...args: any[]): Promise<any>;
    removeAllListeners(channel: string): void;
  };

  export const webContents: {
    fromId(id: number): WebContents | undefined;
  };

  export const contextBridge: {
    exposeInMainWorld(apiKey: string, api: any): void;
  };
}
