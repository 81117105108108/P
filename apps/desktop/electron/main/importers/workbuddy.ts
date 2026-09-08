import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ExternalSessionSummary,
  ImportedSession,
  ImportedUiMessage,
  SessionImporter,
} from "./types";
import { importedSessionId, toIso, truncateTitle } from "./types";

const PROJECTS_DIR = path.join(os.homedir(), ".workbuddy", "projects");

interface WorkBuddyBlock {
  type?: string;
  text?: string;
}

interface WorkBuddyLine {
  type?: string;
  role?: string;
  timestamp?: number | string;
  cwd?: string;
  sessionId?: string;
  id?: string;
  parentId?: string;
  content?: string | WorkBuddyBlock[];
  // function_call
  callId?: string;
  name?: string;
  arguments?: string;
  // function_call_result
  status?: string;
  output?: WorkBuddyBlock | WorkBuddyBlock[];
  // ai-title
  aiTitle?: string;
  providerData?: { model?: string };
}

const TEXT_BLOCKS = new Set(["text", "input_text", "output_text"]);

// Every WorkBuddy user turn is wrapped in injected context: a large
// <system-reminder> block (system prompt, tool list, memory reminders) and,
// after compaction, a <cb_summary> block. The real prompt sits in
// <user_query>. Without stripping these, titles and message bodies turn into
// walls of system prompt.
const INJECTED_BLOCK =
  /<(system-reminder|cb_summary|conversation_history_summary)\b[\s\S]*?<\/\1>/gi;

// Compaction can leave an injected block without its closing tag; treat
// everything from the opening tag on as injected context.
const UNCLOSED_BLOCK =
  /<(system-reminder|cb_summary|conversation_history_summary)\b[\s\S]*$/i;

const USER_QUERY = /<user_query>([\s\S]*?)<\/user_query>/i;

// Oversized tool results are externalized; the inline text keeps the path.
const PERSISTED_OUTPUT = /<persisted-output>[\s\S]*?Full output saved to:\s*(\S+)/i;

async function readLines(filePath: string): Promise<WorkBuddyLine[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const out: WorkBuddyLine[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

function blockText(content: string | WorkBuddyBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => TEXT_BLOCKS.has(b.type ?? "") && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function stripInjected(text: string): string {
  const paired = text.replace(INJECTED_BLOCK, "");
  // Prefer the explicit prompt tag so a real prompt survives even when an
  // injected block around it is malformed.
  const query = paired.match(USER_QUERY);
  if (query) return query[1].trim();
  return paired.replace(UNCLOSED_BLOCK, "").trim();
}

function resultText(output: WorkBuddyBlock | WorkBuddyBlock[] | undefined): string {
  if (!output) return "";
  if (Array.isArray(output)) return blockText(output);
  if (typeof output.text === "string") return output.text.trim();
  return "";
}

function persistedPath(text: string): string | null {
  const match = text.match(PERSISTED_OUTPUT);
  return match ? match[1] : null;
}

/** Large tool results live in <session>/tool-results/*.txt — read them back. */
async function resolveResultText(
  output: WorkBuddyBlock | WorkBuddyBlock[] | undefined,
): Promise<string> {
  const text = resultText(output);
  const external = persistedPath(text);
  if (!external) return text;
  // Only follow paths inside the WorkBuddy projects root.
  if (!path.resolve(external).startsWith(path.resolve(PROJECTS_DIR) + path.sep)) {
    return text;
  }
  try {
    const full = await fs.readFile(external, "utf8");
    return full.trim() || text;
  } catch {
    return text;
  }
}

function parseArgs(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function isConversationLine(line: WorkBuddyLine): boolean {
  return (
    line.type === "message" && (line.role === "user" || line.role === "assistant")
  );
}

export const workbuddyImporter: SessionImporter = {
  source: "workbuddy",

  async scan(): Promise<ExternalSessionSummary[]> {
    let projectDirs: string[] = [];
    try {
      projectDirs = await fs.readdir(PROJECTS_DIR);
    } catch {
      return [];
    }
    const summaries: ExternalSessionSummary[] = [];
    for (const dir of projectDirs) {
      const dirPath = path.join(PROJECTS_DIR, dir);
      let files: string[] = [];
      try {
        files = (await fs.readdir(dirPath)).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        try {
          const lines = await readLines(filePath);
          const convo = lines.filter(isConversationLine);
          if (convo.length === 0) continue;
          const externalId = path.basename(file, ".jsonl");
          const aiTitle = lines
            .filter((l) => l.type === "ai-title" && l.aiTitle)
            .map((l) => l.aiTitle!)
            .pop();
          const firstUser = convo.find((l) => {
            if (l.role !== "user") return false;
            return !!stripInjected(blockText(l.content));
          });
          const model =
            convo.find((l) => l.role === "assistant" && l.providerData?.model)
              ?.providerData?.model ?? null;
          summaries.push({
            source: "workbuddy",
            externalId,
            title:
              truncateTitle(aiTitle ?? "") ||
              truncateTitle(stripInjected(blockText(firstUser?.content)) || "") ||
              externalId,
            projectPath: lines.find((l) => l.cwd)?.cwd ?? null,
            model,
            createdAt: toIso(lines[0]?.timestamp),
            updatedAt: toIso(lines[lines.length - 1]?.timestamp),
            messageCount: convo.length,
            filePath,
          });
        } catch {
          // unreadable session file — skip
        }
      }
    }
    return summaries;
  },

  async convert(summary: ExternalSessionSummary): Promise<ImportedSession> {
    const lines = await readLines(summary.filePath);
    const messages: ImportedUiMessage[] = [];
    const pendingTools = new Map<
      string,
      { name: string; args: unknown; createdAt: string }
    >();

    for (const line of lines) {
      if (line.type === "function_call" && line.callId) {
        pendingTools.set(line.callId, {
          name: line.name ?? "tool",
          args: parseArgs(line.arguments),
          createdAt: toIso(line.timestamp),
        });
        continue;
      }

      if (line.type === "function_call_result" && line.callId) {
        const pending = pendingTools.get(line.callId);
        pendingTools.delete(line.callId);
        const createdAt = toIso(line.timestamp);
        const text = await resolveResultText(line.output);
        const failed = line.status === "error" || line.status === "failed";
        messages.push({
          id: crypto.randomUUID(),
          role: "tool",
          content: text,
          createdAt,
          toolName: line.name ?? pending?.name,
          toolCallId: line.callId,
          toolStatus: failed ? "error" : "success",
          toolArgs: pending?.args,
          toolResult: text,
          isError: failed || undefined,
          status: "complete",
        });
        continue;
      }

      if (!isConversationLine(line)) continue;

      const createdAt = toIso(line.timestamp);
      if (line.role === "assistant") {
        const text = blockText(line.content);
        if (text) {
          messages.push({
            id: crypto.randomUUID(),
            role: "assistant",
            content: text,
            createdAt,
            status: "complete",
          });
        }
      } else {
        const text = stripInjected(blockText(line.content));
        if (text) {
          messages.push({
            id: crypto.randomUUID(),
            role: "user",
            content: text,
            createdAt,
          });
        }
      }
    }

    return {
      session: {
        id: importedSessionId("workbuddy", summary.externalId),
        title: summary.title,
        projectPath: summary.projectPath,
        modelId: summary.model,
        providerId: null,
        mode: "agent",
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
      },
      messages,
    };
  },
};
