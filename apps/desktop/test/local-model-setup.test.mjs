import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as shared from "@pi-desktop/shared";

const require = createRequire(import.meta.url);
// Execute the actual TSX component and callbacks with shallow hook/API stubs.
// This is a component unit test, not a browser or live-provider test.
function setup(provider) {
  const state = [];
  let cursor = 0;
  let discovery;
  let saved;
  let picker;
  const models = [{ id: "org/local:latest", availableForSubagents: true }];
  const api = Object.fromEntries(["createProvider", "updateProvider"].map((method) => [method,
    async (input) => { saved = { method, input }; return { provider: input }; }]));
  const stubs = {
    react: {
      useState: (initial) => {
        const i = cursor++;
        if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial;
        return [state[i], (value) => { state[i] = typeof value === "function" ? value(state[i]) : value; }];
      },
      useRef: () => ({ current: null }), useEffect: () => {},
    },
    "react-i18next": { useTranslation: () => ({ t: (key) => key }) },
    "@pi-desktop/shared": shared,
    "../../lib/api": { api },
    "../extensions/KeyValueRows": { pairsToRecord: () => ({}), recordToPairs: () => [] },
    "../ui": Object.fromEntries(["Button", "Field", "Input", "Select"].map((name) => [name, name])),
    "./ProviderHeadersEditor": { ProviderHeadersEditor: "Headers" },
    "./ServicePicker": { CUSTOM_SERVICE: "custom", ServicePicker: "ServicePicker" },
    "./useProviderModels": { useProviderModels: (...args) => { discovery = args; return {}; } },
    "./ModelSelectionPanes": { ModelSelectionPanes: "Models", useModelSelection: (_d, _m, setModels) => {
      picker = setModels; return { bindingsToPersist: models };
    } },
  };
  const source = readFileSync(new URL("../src/components/settings/ProviderSetupDialog.tsx", import.meta.url), "utf8");
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, {
    exports, require: (id) => id in stubs ? stubs[id] : require(id),
    URL, window: { setTimeout: () => {} },
  });
  const render = () => { cursor = 0; return exports.ProviderSetupDialog({ provider, onSaved() {}, onClose() {} }); };
  const find = (node, predicate) => {
    if (!node || typeof node !== "object") return undefined;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const found = find(child, predicate); if (found) return found;
    }
  };
  return { render, find, discovery: () => discovery, saved: () => saved, selectModels: () => picker(models) };
}

for (const id of ["ollama", "lmstudio"]) {
  for (const editing of [false, true]) {
    test(`${id} ${editing ? "repairs" : "creates"} no-auth setup and discovers without a key`, async () => {
      const preset = shared.NAMED_ENDPOINT_PRESETS.find((p) => p.id === id);
      const app = setup(editing ? { ...preset, id: "stored", authKind: "api_key_and_base_url", models: [] } : undefined);
      let tree = app.render();
      if (!editing) {
        app.find(tree, (n) => n.type === "ServicePicker").props.onChange(id);
        tree = app.render();
      }
      assert.equal(app.discovery()[0], true);
      assert.equal(app.discovery()[1].apiKey, "");
      assert.equal(app.discovery()[1].baseUrl, preset.baseUrl);
      assert.equal(app.discovery()[2], undefined);
      assert.equal(app.find(tree, (n) => n.props?.type === "password"), undefined);
      app.selectModels();
      tree = app.render();
      const save = app.find(tree, (n) => n.type === "Button" && n.props.children === "settings.saveProvider");
      assert.equal(save.props.disabled, false);
      await save.props.onClick();
      assert.equal(app.saved().method, editing ? "updateProvider" : "createProvider");
      assert.equal(app.saved().input.authKind, "none");
      assert.equal(app.saved().input.secretValue, undefined);
      assert.equal(app.saved().input.vendorKey, id);
    });
  }
}

test("cloud presets still wait for credentials", () => {
  const app = setup();
  app.find(app.render(), (n) => n.type === "ServicePicker").props.onChange("openai");
  const tree = app.render();
  assert.equal(app.discovery()[0], false);
  assert.ok(app.find(tree, (n) => n.props?.type === "password"));
});

test("switching service clears an unsaved cloud key", () => {
  const app = setup();
  app.find(app.render(), (n) => n.type === "ServicePicker").props.onChange("openai");
  app.find(app.render(), (n) => n.props?.type === "password").props.onChange({ target: { value: "cloud-secret" } });
  app.find(app.render(), (n) => n.type === "ServicePicker").props.onChange("ollama");
  app.render();
  assert.equal(app.discovery()[1].apiKey, "");
  app.find(app.render(), (n) => n.type === "ServicePicker").props.onChange("openai");
  app.render();
  assert.equal(app.discovery()[0], false);
});

test("saving an existing custom no-auth endpoint preserves auth", async () => {
  const app = setup({ id: "custom", vendorKey: "custom", name: "My endpoint",
    baseUrl: "http://127.0.0.1:9999/v1", authKind: "none", models: [] });
  app.render();
  app.selectModels();
  await app.find(app.render(), (n) => n.type === "Button" && n.props.children === "settings.saveProvider").props.onClick();
  assert.equal(app.saved().input.authKind, "none");
});

test("the actual Local-Scout draft helper prevents placeholder saves and cloud inheritance", () => {
  const source = readFileSync(new URL("../src/components/settings/SubagentEditorSheet.tsx", import.meta.url), "utf8");
  const wanted = new Set(["emptySubagentDraft", "applySubagentPreset", "subagentDraftError", "subagentSlug"]);
  const ast = ts.createSourceFile("editor.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const code = ast.statements.filter((n) => ts.isFunctionDeclaration(n) && wanted.has(n.name?.text))
    .map((n) => n.getText(ast)).join("\n");
  const exports = {};
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, ...shared, MAX_SUBAGENT_BYTES: 32 * 1024, TextEncoder });
  const draft = exports.applySubagentPreset({ ...exports.emptySubagentDraft(), model: "openai/expensive" },
    shared.findSubagentPreset("local-scout"));
  assert.equal(draft.model, "ollama/<model-id>");
  assert.equal(exports.subagentDraftError(draft), "extensions.subagents.errorModel");
  for (const model of ["ollama/org/model:latest", "lmstudio/org/model"]) {
    assert.equal(exports.subagentDraftError({ ...draft, model }), null);
  }
  assert.equal(draft.tools.join(","), "Read,Glob,Grep");
  assert.equal(draft.maxTurns, 40);
});
