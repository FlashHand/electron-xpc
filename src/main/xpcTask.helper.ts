import { Semaphore } from '@rig-lib/semaphore';
import { XpcPayload } from '../shared/xpc.type';

export class XpcTask implements XpcPayload {
  id: string;
  handleName: string;
  params?: any;
  ret?: any;
  /**
   * portId of the utility process this task was forwarded to.
   * Undefined for main-process and renderer targets. Set so that a utility
   * process exiting can settle the tasks that will never be answered.
   */
  targetPortId?: string;

  private semaphore: Semaphore;

  constructor(payload: XpcPayload) {
    this.id = payload.id;
    this.handleName = payload.handleName;
    this.params = payload.params;
    this.ret = payload.ret ?? null;
    this.semaphore = new Semaphore(1);
    this.semaphore.take(() => {});
  }

  /** Block until unblock() is called */
  block(): Promise<void> {
    return this.semaphore.takeAsync();
  }

  /** Release the semaphore, unblocking the waiting block() call */
  unblock(): void {
    this.semaphore.leave();
  }

  /** Convert to a plain XpcPayload (serializable for IPC) */
  toPayload(): XpcPayload {
    return {
      id: this.id,
      handleName: this.handleName,
      params: this.params,
      ret: this.ret,
    };
  }
}
