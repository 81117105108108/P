/**
 * Deterministic history stripping before LLM compaction (ADR 0208).
 *
 * LLM summarization at 70% window is expensive. First pass is free: replace
 * stale full-file Reads and verbose Bash logs with stubs, keeping checksums
 * and tails so the model can re-inspect on demand. Target 40–60% volume cut
 * with zero summarizer tokens.
 */

/** Lines of compiler/test output kept; head is discarded. */
export const PRUNE_TAIL_LINES = 10;
/** Tool outputs above this get stubbed when stale. */
export const PRUNE_MIN_LINES = 100;

/** Tiny non-crypto checksum for stub identity (FNV-1a 32-bit hex). */
export function stubChecksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function lineCount(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

/** Stub a stale full-file Read output. */
export function pruneReadOutput(text: string): string {
  const lines = lineCount(text);
  if (lines < PRUNE_MIN_LINES) return text;
  return (
    `[File content pruned: ${lines} lines. Checksum: ${stubChecksum(text)}. ` +
    `Use Read tool to re-inspect if needed]`
  );
}

/** Truncate verbose Bash output to exit code + last N lines. */
export function pruneBashOutput(text: string, exitCode = 0): string {
  const lines = text.split("\n");
  if (lines.length < PRUNE_MIN_LINES) return text;
  const tail = lines.slice(-PRUNE_TAIL_LINES).join("\n");
  return `[Log pruned: kept last ${PRUNE_TAIL_LINES} of ${lines.length} lines, exit ${exitCode}]\n${tail}`;
}
