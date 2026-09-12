import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  CONTEXT_GUARD_KEEP_TURNS,
  stripStaleToolResults,
} from "./context-guard.js";

const bigText = Array.from({ length: 150 }, (_, index) => `line ${index}`).join(
  "\n",
);

function user(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: 0 } as AgentMessage;
}

function toolResult(
  toolName: string,
  text: string,
  options: { isError?: boolean; extraImage?: boolean } = {},
): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: `call-${toolName}`,
    toolName,
    content: [
      ...(options.extraImage
        ? [{ type: "image" as const, data: "AAAA", mimeType: "image/png" }]
        : []),
      { type: "text" as const, text },
    ],
    isError: options.isError ?? false,
    timestamp: 0,
  } as AgentMessage;
}

function textOf(message: AgentMessage): string {
  if (message.role !== "toolResult") throw new Error("not a tool result");
  return message.content
    .filter((block): block is { type: "text"; text: string } => {
      return block.type === "text";
    })
    .map((block) => block.text)
    .join("");
}

describe("context guard", () => {
  it("tombstones stale Read output and keeps recent output intact", () => {
    const messages = [
      user("t1"),
      toolResult("Read", bigText),
      user("t2"),
      user("t3"),
      user("t4"),
      toolResult("Read", bigText),
    ];
    const guarded = stripStaleToolResults(messages);
    expect(guarded).not.toBe(messages);
    expect(textOf(guarded[1]!)).toMatch(/File content pruned: 150 lines/);
    expect(textOf(guarded[5]!)).toBe(bigText);
  });

  it("returns the same array when nothing crosses the threshold", () => {
    const small = Array.from({ length: 10 }, (_, index) => `l${index}`).join("\n");
    const messages = [
      user("t1"),
      toolResult("Read", small),
      user("t2"),
      user("t3"),
      user("t4"),
    ];
    expect(stripStaleToolResults(messages)).toBe(messages);
    expect(CONTEXT_GUARD_KEEP_TURNS).toBe(2);
  });

  it("prunes stale Bash output with its failure status", () => {
    const messages = [
      user("t1"),
      toolResult("Bash", bigText, { isError: true }),
      user("t2"),
      user("t3"),
      user("t4"),
    ];
    const guarded = stripStaleToolResults(messages);
    expect(textOf(guarded[1]!)).toMatch(/kept last 10 of 150 lines, exit 1/);
  });

  it("keeps non-text blocks while stripping the text block", () => {
    const messages = [
      user("t1"),
      toolResult("Read", bigText, { extraImage: true }),
      user("t2"),
      user("t3"),
      user("t4"),
    ];
    const guarded = stripStaleToolResults(messages);
    const result = guarded[1]!;
    if (result.role !== "toolResult") throw new Error("not a tool result");
    expect(result.content[0]).toEqual({
      type: "image",
      data: "AAAA",
      mimeType: "image/png",
    });
    expect(result.content).toHaveLength(2);
  });

  it("honors a tighter keep window", () => {
    const messages = [
      user("t1"),
      toolResult("Read", bigText),
      user("t2"),
      toolResult("Read", bigText),
    ];
    const guarded = stripStaleToolResults(messages, 0);
    expect(textOf(guarded[1]!)).toMatch(/pruned/);
    expect(textOf(guarded[3]!)).toBe(bigText);
  });
});
