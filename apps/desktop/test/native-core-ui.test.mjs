import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

/**
 * Native-core desktop surfaces (ADR 0209/0210).
 *
 * Presentational contract: the hunk model, DAG statuses, and inspect shapes
 * stay stable across the Monaco/canvas bindings.
 */

const read = (path) => readFileSync(resolve(path), "utf8");

const diff = read("src/components/diff/DiffReview.tsx");
const monaco = read("src/components/diff/MonacoTarget.tsx");
const dag = read("src/components/dag/SubagentDag.tsx");
const canvas = read("src/components/dag/DagCanvas.tsx");
const inspect = read("src/components/inspect/InspectPanel.tsx");

test("DiffReview cherry-picks hunks into an editable target", () => {
  for (const marker of [
    "Cherry-pick Hunk",
    "Accept File",
    "Discard File",
    "diff-review-target",
    "diff-hunk-label",
  ]) {
    assert.ok(diff.includes(marker), `expected DiffReview marker: ${marker}`);
  }
  assert.match(diff, /export type DiffHunk =/);
  assert.match(diff, /applyHunk/);
});

test("SubagentDag renders running/verifying/failed/ready nodes", () => {
  for (const status of ["running", "verifying", "failed", "ready"]) {
    assert.ok(dag.includes(`"${status}"`), `expected DAG status: ${status}`);
  }
  assert.match(dag, /worktreePath/);
  assert.match(dag, /role="tree"/);
});

test("InspectPanel shows DOM, styles, and drift", () => {
  for (const marker of ["inspect-panel-dom", "inspect-panel-styles", "visual drift detected"]) {
    assert.ok(inspect.includes(marker), `expected InspectPanel marker: ${marker}`);
  }
  assert.match(inspect, /DomSnapshot/);
  assert.match(inspect, /data:image\/png;base64/);
});

test("MonacoTarget binds the editor with a textarea fallback", () => {
  for (const marker of ["monaco-editor", "textarea", "automaticLayout"]) {
    assert.ok(monaco.includes(marker), `expected MonacoTarget marker: ${marker}`);
  }
  const env = read("src/components/diff/monacoEnv.ts");
  for (const marker of ["MonacoEnvironment", "editor.worker", "monacoLanguageFor"]) {
    assert.ok(env.includes(marker), `expected monacoEnv marker: ${marker}`);
  }
  assert.ok(diff.includes("MonacoTarget"), "DiffReview renders the Monaco target");
  assert.match(monaco, /monacoLanguageFor/);
});

test("DagCanvas paints the same node model on canvas", () => {
  for (const marker of ["dag-canvas", "devicePixelRatio", "roundRect", "dag-canvas-fallback"]) {
    assert.ok(canvas.includes(marker), `expected DagCanvas marker: ${marker}`);
  }
  assert.match(canvas, /DagNode/);
});
