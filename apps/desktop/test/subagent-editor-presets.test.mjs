/**
 * UI-side coverage for the Subagent editor changes from issue #60:
 *
 *  - The sheet ships a preset picker driven by `SUBAGENT_PRESETS`, so the
 *    user can start from `explorer`, `code-reviewer`, `test-runner` or
 *    `fixer` instead of an empty form.
 *  - The model field is a picker over the configured providers'
 *    `availableForSubagents` bindings, not a free-text input.
 *
 * These tests scan the source files rather than mount React, so they verify
 * the wiring (preset ids, model filtering, custom fallback) without dragging
 * in a renderer harness.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editorSource = await readFile(
  new URL("../src/components/settings/SubagentEditorSheet.tsx", import.meta.url),
  "utf8",
);
const sharedPresets = await readFile(
  new URL("../../../packages/shared/src/subagent-presets.ts", import.meta.url),
  "utf8",
);
const sharedPresetsTest = await readFile(
  new URL("../../../packages/shared/src/subagent-presets.test.ts", import.meta.url),
  "utf8",
);
const sharedIndex = await readFile(
  new URL("../../../packages/shared/src/index.ts", import.meta.url),
  "utf8",
);
const extensionsCss = await readFile(
  new URL("../src/styles/extensions.css", import.meta.url),
  "utf8",
);

test("the editor imports the shared preset catalog", () => {
  assert.match(editorSource, /from "@pi-desktop\/shared"/);
  assert.match(editorSource, /SUBAGENT_PRESETS/);
});

test("the shared index re-exports the preset catalog", () => {
  assert.match(sharedIndex, /export \* from "\.\/subagent-presets\.js"/);
});

test("the preset catalog covers the four builtin roles", () => {
  for (const id of ["explorer", "code-reviewer", "test-runner", "fixer"]) {
    assert.match(
      sharedPresets,
      new RegExp(`id: "${id}"`),
      `expected preset id ${id} to be defined`,
    );
  }
});

test("the preset catalog has unit-test coverage", () => {
  // The tests under `subagent-presets.test.ts` lock down the public surface
  // (preset ids, non-empty tools/body, maxTurns within clamp). Asserting the
  // file exists here guards against accidental deletion of those tests when
  // the catalog grows.
  assert.match(sharedPresetsTest, /describe\("SUBAGENT_PRESETS"/);
  assert.match(sharedPresetsTest, /describe\("findSubagentPreset"/);
  assert.match(sharedPresetsTest, /describe\("defaultSubagentPresetTools"/);
});

test("the editor renders the preset grid for new subagents only", () => {
  assert.match(editorSource, /function PresetPicker/);
  assert.match(editorSource, /\{!editing \? \(\s*<PresetPicker/);
});

test("the editor applies a preset by overwriting the draft body and tools", () => {
  assert.match(editorSource, /function applySubagentPreset\(/);
  assert.match(
    editorSource,
    /export function applySubagentPreset\(draft: SubagentDraft, preset: SubagentPreset\)/,
  );
  // The replacement is wholesale: tools / maxTurns / body / description must
  // all be overwritten so the runtime sees the preset the user picked.
  assert.match(editorSource, /tools: \[\.\.\.preset\.tools\]/);
  assert.match(editorSource, /maxTurns: preset\.maxTurns/);
  assert.match(editorSource, /body: preset\.body/);
  assert.match(editorSource, /description: preset\.description/);
});

test("the editor splits a provider/model pin correctly", () => {
  // The model picker uses splitModelPin to map the draft's `model` value back
  // onto a configured option; the splits below mirror what the runtime
  // resolver accepts in `BUILTIN_SUBAGENT_DOCUMENTS`.
  assert.match(editorSource, /export function splitModelPin\(/);
  assert.match(editorSource, /const slash = trimmed\.indexOf\("\/"\)/);
  // An id may itself contain a slash (openrouter style), so the test must
  // exercise that case rather than split on the last segment.
  assert.match(editorSource, /slice\(slash \+ 1\)/);
});

test("the model picker filters providers by availableForSubagents", () => {
  // The picker must not list a model that the user disabled for delegation;
  // a model that does exist but is not flagged would silently launch and
  // spend the wrong provider's quota (issue #60's regression risk).
  assert.match(editorSource, /availableForSubagents/);
  assert.match(editorSource, /function ModelField/);
  assert.match(editorSource, /api\s*\.\s*listProviders\s*\(\s*\)/);
});

test("the model picker keeps a free-text fallback", () => {
  // "Custom (provider/model)…" must remain reachable: a user with a hand-typed
  // pin (or a model that has not yet been flagged for subagents) still needs
  // an escape hatch.
  assert.match(editorSource, /__custom__/);
  assert.match(editorSource, /modelPickCustom/);
});

test("the editor styles ship with the picker", () => {
  assert.match(extensionsCss, /\.ext-preset-pick/);
  assert.match(extensionsCss, /\.ext-preset-chip/);
  assert.match(extensionsCss, /\.ext-preset-chip\.is-selected/);
});