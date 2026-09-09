/**
 * The subagent editor pins a model from the configured, runnable list rather
 * than a free-typed `provider/model` string. These tests pin that mapping so a
 * later edit cannot silently put the text field back or drop an existing pin.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const {
  groupSubagentModelChoices,
  isSubagentModelProvider,
  subagentModelChoices,
  subagentModelOrphanPin,
  subagentModelPin,
  subagentModelSelectValue,
} = await import("../src/components/settings/subagent-models.ts");

const binding = (id) => ({
  id,
  contextWindow: 128_000,
  maxTokens: 8_192,
  thinkingLevels: [],
  defaultThinkingLevel: null,
});

const provider = (over = {}) => ({
  id: "p1",
  name: "Anthropic",
  vendorKey: "anthropic",
  enabled: true,
  hasSecret: true,
  hasOauth: false,
  authKind: "api_key_and_base_url",
  models: [binding("claude-haiku-4-5"), binding("claude-sonnet-4-6")],
  ...over,
});

test("a pin uses the vendor key a person would type, not the UUID", () => {
  assert.equal(
    subagentModelPin({ vendorKey: "anthropic", name: "Anthropic" }, "claude-haiku-4-5"),
    "anthropic/claude-haiku-4-5",
  );
});

test("a custom endpoint with no vendor key falls back to its display name", () => {
  assert.equal(
    subagentModelPin({ vendorKey: "  ", name: "My Gateway" }, "local-model"),
    "My Gateway/local-model",
  );
});

test("the sheet lists configured models from enabled, credentialed providers", () => {
  const choices = subagentModelChoices([
    provider(),
    provider({
      id: "p2",
      name: "My Gateway",
      vendorKey: "",
      models: [binding("local-model")],
    }),
    provider({
      id: "off",
      name: "Disabled",
      vendorKey: "openai",
      enabled: false,
      models: [binding("gpt-5")],
    }),
    provider({
      id: "empty",
      name: "No key",
      vendorKey: "openai",
      hasSecret: false,
      authKind: "api_key_and_base_url",
      models: [binding("gpt-5")],
    }),
  ]);

  assert.deepEqual(
    choices.map((choice) => choice.value),
    ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-6", "My Gateway/local-model"],
  );
});

test("a vendor-account row with only OAuth still offers its configured models", () => {
  const choices = subagentModelChoices([
    provider({
      id: "oauth",
      name: "Claude Pro",
      vendorKey: "anthropic",
      hasSecret: false,
      hasOauth: true,
      authKind: "oauth",
      models: [binding("claude-opus-4-6")],
    }),
  ]);
  assert.deepEqual(
    choices.map((choice) => choice.value),
    ["anthropic/claude-opus-4-6"],
  );
});

test("a no-auth local provider still offers its configured models", () => {
  const choices = subagentModelChoices([
    provider({
      id: "local",
      name: "Ollama",
      vendorKey: "",
      hasSecret: false,
      authKind: "none",
      models: [binding("llama3")],
    }),
  ]);
  assert.deepEqual(
    choices.map((choice) => choice.value),
    ["Ollama/llama3"],
  );
  assert.equal(
    isSubagentModelProvider(
      provider({ authKind: "none", hasSecret: false, vendorKey: "" }),
    ),
    true,
  );
});

test("duplicate vendor-key pins collapse to one option", () => {
  const choices = subagentModelChoices([
    provider(),
    provider({
      id: "p2",
      name: "Anthropic work",
      vendorKey: "anthropic",
      models: [binding("claude-haiku-4-5")],
    }),
  ]);
  assert.equal(
    choices.filter((choice) => choice.value === "anthropic/claude-haiku-4-5").length,
    1,
  );
});

test("choices group by the owning provider", () => {
  const groups = groupSubagentModelChoices(
    subagentModelChoices([
      provider(),
      provider({
        id: "p2",
        name: "My Gateway",
        vendorKey: "",
        models: [binding("local-model")],
      }),
    ]),
  );
  assert.deepEqual(
    groups.map((group) => ({
      providerName: group.providerName,
      models: group.choices.map((choice) => choice.modelId),
    })),
    [
      { providerName: "Anthropic", models: ["claude-haiku-4-5", "claude-sonnet-4-6"] },
      { providerName: "My Gateway", models: ["local-model"] },
    ],
  );
});

test("a pin written with the display name still selects the vendor-key option", () => {
  const choices = subagentModelChoices([provider()]);
  assert.equal(
    subagentModelSelectValue("Anthropic/claude-haiku-4-5", choices),
    "anthropic/claude-haiku-4-5",
  );
  assert.equal(subagentModelOrphanPin("Anthropic/claude-haiku-4-5", choices), null);
  assert.equal(subagentModelSelectValue("", choices), "");
});

test("a pin that is no longer configured stays selectable", () => {
  const choices = subagentModelChoices([provider()]);
  assert.equal(
    subagentModelSelectValue("openai/gpt-5", choices),
    "openai/gpt-5",
  );
  assert.equal(subagentModelOrphanPin("openai/gpt-5", choices), "openai/gpt-5");
});

test("the editor model field is a select of configured models, not a text input", async () => {
  const source = await readFile(
    new URL("../src/components/settings/SubagentEditorSheet.tsx", import.meta.url),
    "utf8",
  );
  const modelField = source.slice(
    source.indexOf('label={t("extensions.subagents.model")}'),
    source.indexOf('label={t("extensions.subagents.thinking")}'),
  );
  assert.match(modelField, /<Select/);
  assert.match(modelField, /<optgroup/);
  assert.match(modelField, /extensions\.subagents\.modelInherit/);
  assert.match(source, /subagentModelChoices\(providers\)/);
  assert.doesNotMatch(modelField, /<Input/);
  assert.doesNotMatch(modelField, /modelPlaceholder/);
});
