/**
 * High-performance process-unique ID generator for renderer process.
 * Combines a random prefix (per process) with an incrementing counter.
 * Guaranteed unique within a single process lifetime.
 */
const prefix = Math.random().toString(36).slice(2, 8);
let counter = 0;

export const generateXpcId = (): string => {
  return `r-${prefix}-${(++counter).toString(36)}`;
};
