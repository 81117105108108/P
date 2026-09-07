import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseClaudeCodeModelConfig,
  parseCodexModelConfig,
  parseJsonDocument,
  parseOpenCodeModelConfig,
  parsePiModelConfig,
  type ModelConfigImportDraft,
  type ModelConfigImportEnv,
} from "@pi-desktop/shared";

export type ModelConfigScanOptions = {
  homeDir?: string;
  env?: ModelConfigImportEnv;
};

async function readText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readJson(filePath: string): Promise<unknown | null> {
  const text = await readText(filePath);
  if (text == null) return null;
  return parseJsonDocument(text);
}

export async function scanModelConfigs(
  options: ModelConfigScanOptions = {},
): Promise<ModelConfigImportDraft[]> {
  const home = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;
  const groups = await Promise.all([
    scanClaude(home),
    scanOpenCode(home, env),
    scanCodex(home, env),
    scanPi(home, env),
  ]);
  return groups.flat();
}

async function scanClaude(home: string): Promise<ModelConfigImportDraft[]> {
  const settings = await readJson(path.join(home, ".claude", "settings.json"));
  const local = await readJson(path.join(home, ".claude", "settings.local.json"));
  return parseClaudeCodeModelConfig(settings, local);
}

async function scanOpenCode(
  home: string,
  env: ModelConfigImportEnv,
): Promise<ModelConfigImportDraft[]> {
  const configDir = path.join(home, ".config", "opencode");
  const config =
    (await readJson(path.join(configDir, "opencode.json"))) ??
    (await readJson(path.join(configDir, "opencode.jsonc")));
  const auth =
    (await readJson(path.join(home, ".local", "share", "opencode", "auth.json"))) ??
    (await readJson(path.join(configDir, "auth.json")));
  return parseOpenCodeModelConfig(config, auth, env);
}

async function scanCodex(
  home: string,
  env: ModelConfigImportEnv,
): Promise<ModelConfigImportDraft[]> {
  const text = await readText(path.join(home, ".codex", "config.toml"));
  if (text == null) return [];
  return parseCodexModelConfig(text, env);
}

async function scanPi(
  home: string,
  env: ModelConfigImportEnv,
): Promise<ModelConfigImportDraft[]> {
  const models =
    (await readJson(path.join(home, ".pi", "agent", "models.json"))) ??
    (await readJson(path.join(home, ".pi", "models.json")));
  return parsePiModelConfig(models, env);
}
