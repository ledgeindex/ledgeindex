/**
 * Source + job persistence (today `Store` in ledgeindex-api).
 * Full method surface stays in docs/runtime until store types move into core.
 */
export type SourceRecords = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: (...args: any[]) => unknown;
};
