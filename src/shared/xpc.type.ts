export type XpcPayload = {
  /** Unique task ID, guaranteed unique within process lifetime */
  id: string;
  /** Event handle name */
  handleName: string;
  /** Parameters, nullable */
  params?: any;
  /** Return data from target process, nullable, defaults to null */
  ret?: any;
};

export type XpcRendererApi = {
  handle: (handleName: string, handler: (payload: XpcPayload) => Promise<any>) => void;
  removeHandle: (handleName: string) => void;
  send: (handleName: string, params?: any) => Promise<any>;
};
