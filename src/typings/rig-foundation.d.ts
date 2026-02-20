declare module 'rig-foundation' {
  export class Semaphore {
    constructor(count: number);
    take(callback: () => void): void;
    takeAsync(): Promise<void>;
    leave(): void;
  }
}
