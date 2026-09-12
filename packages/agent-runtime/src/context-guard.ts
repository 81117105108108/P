/**
 * Deterministic context guard (ADR 0208/0209, plan 4.1).
 *
 * Between the point where a session approaches the hard compaction limit and
 * the point where pi's summarizer rewrites history, the cheapest win is
 * zero-token stripping: stale large Read/Bash outputs become tombstones the
 * model can re-inspect on demand. Only tool-result text changes — role,
 * `toolCallId`, and call/result pairing stay intact, so providers never see an
 * orphaned tool call.
 */

import {
  pruneBashOutput,
  pruneReadOutput,
} from "@pi-desktop/shared";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

/** Stripping arms once the live context crosses this share of the hard limit. */
export const CONTEXT_GUARD_STRIP_RATIO = 0.85;

/** User-message distance at or below which a tool result stays intact. */
export const CONTEXT_GUARD_KEEP_TURNS = 2;

const READ_TOOLS = new Set(["Read", "ReadRange"]);
const BASH_TOOLS = new Set(["Bash"]);

function stripResultText(
  text: string,
  toolName: string,
  isError: boolean,
): string {
  // The shared prune helpers keep their own <100-line guard, so small
  // outputs pass through unchanged.
  if (READ_TOOLS.has(toolName)) return pruneReadOutput(text);
  if (BASH_TOOLS.has(toolName)) return pruneBashOutput(text, isError ? 1 : 0);
  return text;
}

/**
 * Tombstone large outputs of tool results older than `keepTurns` user
 * messages. Age is the number of user messages after the result, so results
 * inside the latest turn score 0. Returns the input array unchanged when
 * nothing crosses the threshold.
 */
export function stripStaleToolResults(
  messages: AgentMessage[],
  keepTurns = CONTEXT_GUARD_KEEP_TURNS,
): AgentMessage[] {
  const ages = new Array<number>(messages.length);
  let usersAfter = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    ages[index] = usersAfter;
    if (messages[index]?.role === "user") usersAfter += 1;
  }

  let changed = false;
  const guarded = messages.map((message, index) => {
    if (message.role !== "toolResult") return message;
    if (ages[index]! <= keepTurns) return message;
    let resultChanged = false;
    const content = message.content.map((block) => {
      if (block.type !== "text") return block;
      const text = stripResultText(block.text, message.toolName, message.isError);
      if (text === block.text) return block;
      resultChanged = true;
      return { ...block, text };
    });
    if (!resultChanged) return message;
    changed = true;
    return { ...message, content };
  });
  return changed ? guarded : messages;
}
