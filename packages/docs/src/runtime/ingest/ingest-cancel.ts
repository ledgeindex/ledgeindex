import { cancelDiscoverCrawl } from "../crawler/discover.js";

export class IngestCancelledError extends Error {
  readonly sourceId: string;

  constructor(sourceId: string) {
    super("Indexing cancelled");
    this.name = "IngestCancelledError";
    this.sourceId = sourceId;
  }
}

const cancelRequestedBySource = new Set<string>();

export function requestIngestCancellation(sourceId: string) {
  cancelRequestedBySource.add(sourceId);
}

export function clearIngestCancellation(sourceId: string) {
  cancelRequestedBySource.delete(sourceId);
}

export function isIngestCancellationRequested(sourceId: string): boolean {
  return cancelRequestedBySource.has(sourceId);
}

export function assertIngestNotCancelled(sourceId: string) {
  if (isIngestCancellationRequested(sourceId)) {
    throw new IngestCancelledError(sourceId);
  }
}

export function cancelIngestForSource(sourceId: string): boolean {
  requestIngestCancellation(sourceId);
  cancelDiscoverCrawl(sourceId);
  return true;
}
