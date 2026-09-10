/**
 * Bulk IPC policy: keep small frames on stdio NDJSON, move bulk payloads to
 * chunked range reads (ADR 0208).
 *
 * No transport change in this slice: these constants and builders let callers
 * avoid the bottleneck (5k-line Reads, git diffs, build logs) by requesting
 * windows instead of whole-file buffers.
 */

/** Payloads above this ride range reads, never one NDJSON frame. */
export const BULK_IPC_FRAME_BYTES = 64 * 1024;

/** Default Read window that keeps one frame well under the bulk limit. */
export const DEFAULT_READ_LINES = 200;
/** Hard per-line cap so one minified line cannot blow a frame. */
export const MAX_LINE_CHARS = 4000;

export type ReadRange = {
  path: string;
  offset: number;
  limit: number;
};

/** True when the payload must use range reads / streaming, not one frame. */
export function isBulkPayload(byteLength: number): boolean {
  return byteLength > BULK_IPC_FRAME_BYTES;
}

/** Build a bounded range request for `fs.readRange`-style calls. */
export function readRangeRequest(
  path: string,
  offset: number,
  limit: number = DEFAULT_READ_LINES,
): ReadRange {
  return {
    path,
    offset: Math.max(0, Math.floor(offset)),
    limit: Math.max(1, Math.min(Math.floor(limit), 2000)),
  };
}

/** Split a large line window into frame-safe chunks. */
export function splitRange(offset: number, limit: number, chunk = DEFAULT_READ_LINES): ReadRange[] {
  const out: ReadRange[] = [];
  let rest = limit;
  let at = offset;
  while (rest > 0) {
    const take = Math.min(rest, chunk);
    out.push({ path: "", offset: at, limit: take });
    at += take;
    rest -= take;
  }
  return out;
}
