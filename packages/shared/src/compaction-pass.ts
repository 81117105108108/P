/**
 * Deterministic compaction pre-pass (ADR 0209): zero-token stripping before
 * any LLM summarizer runs.
 *
 * Turns older than K=2 steps with large Read outputs become tombstones
 * (line count + path + SHA256 + re-inspect hint). Verbose CLI output keeps
 * the exit code plus the first 5 and last 10 lines. Mirrors the native
 * `history-pruning` policy so both sides of the bridge agree.
 */

import { pruneBashOutput, pruneReadOutput, stubChecksum } from "./history-pruning.js";

/** Turns older than this (in steps) are eligible for stripping. */
export const COMPACTION_STRIP_AFTER_TURNS = 2;
/** CLI head lines kept alongside the tail. */
export const CLI_HEAD_LINES = 5;

export type CompactableTurn = {
  toolName: string;
  output: string;
  /** Extra context: file path for Reads, exit code for CLI. */
  path?: string;
  exitCode?: number;
};

/** Tombstone for a stripped Read output. */
export function readTombstone(lineCount: number, path: string, hash: string): string {
  return (
    `[File content pruned: ${lineCount} lines. Path: ${path}, SHA256: ${hash}. ` +
    `Call Read to re-inspect.]`
  );
}

/** Strip one turn output when `ageInTurns` exceeds the threshold. */
export function stripTurnOutput(turn: CompactableTurn, ageInTurns: number): string {
  if (ageInTurns <= COMPACTION_STRIP_AFTER_TURNS) return turn.output;
  if (turn.toolName === "Read" || turn.toolName === "ReadRange") {
    const lines = turn.output.split("\n").length;
    if (lines < 100) return turn.output;
    // Reuse the shared stub when no path is known; otherwise tombstone.
    if (!turn.path) return pruneReadOutput(turn.output);
    return readTombstone(lines, turn.path, stubChecksum(turn.output));
  }
  if (turn.toolName === "Bash") {
    return pruneCliOutput(turn.output, turn.exitCode ?? 0);
  }
  return turn.output;
}

/** CLI truncation: exit code + first 5 + last 10 lines. */
export function pruneCliOutput(text: string, exitCode: number): string {
  const lines = text.split("\n");
  if (lines.length < 100) return text;
  const head = lines.slice(0, CLI_HEAD_LINES).join("\n");
  const tail = lines.slice(-10).join("\n");
  return (
    `[Log pruned: exit ${exitCode}, kept first ${CLI_HEAD_LINES} + last 10 of ${lines.length} lines]\n` +
    `${head}\n…\n${tail}`
  );
}

/** Wrap for symmetry with pruneBashOutput consumers. */
export function stripBashCompat(text: string, exitCode: number): string {
  return pruneBashOutput(text, exitCode);
}
