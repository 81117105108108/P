/**
 * UI-side coverage for the Subagent editor changes from issue #60:
 *
 *  - The sheet ships a preset picker driven by `SUBAGENT_PRESETS`, so the
 *    user can start from `explorer`, `code-reviewer`, `test-runner` or
 *    `fixer` instead of an empty form.
 *  - The model field is a picker over the configured, runnable providers'
 *    model bindings, not a free-text input.
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

test("the model picker uses the configured provider catalog", () => {
  // The picker uses the shared provider catalog and preserves an existing
  // orphan pin instead of silently changing it to session inheritance.
  assert.match(editorSource, /subagentModelChoices\(providers\)/);
  assert.match(editorSource, /groupSubagentModelChoices\(modelChoices\)/);
  assert.match(editorSource, /subagentModelOrphanPin\(draft\.model, modelChoices\)/);
});

test("the model picker keeps existing pins visible", () => {
  // A model that is no longer configured remains visible as an orphan option,
  // so editing a definition does not silently clear its model pin.
  assert.match(editorSource, /subagentModelOrphanPin/);
  assert.match(editorSource, /orphanModel \? \(/);
});

test("the editor styles ship with the picker", () => {
  assert.match(extensionsCss, /\.ext-preset-pick/);
  assert.match(extensionsCss, /\.ext-preset-chip/);
  assert.match(extensionsCss, /\.ext-preset-chip\.is-selected/);
});
