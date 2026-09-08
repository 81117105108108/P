import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelSource = await readFile(
  new URL("../src/components/workpanel/SubagentPanel.tsx", import.meta.url),
  "utf8",
);
const workPanelSource = await readFile(
  new URL("../src/components/workpanel/WorkPanel.tsx", import.meta.url),
  "utf8",
);
const appSource = await readFile(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);
const transcriptSource = await readFile(
  new URL("../src/components/ChatTranscript.tsx", import.meta.url),
  "utf8",
);
const storeSource = await readFile(
  new URL("../src/stores/app-store.ts", import.meta.url),
  "utf8",
);
const workPanelCss = await readFile(
  new URL("../src/styles/work-panel.css", import.meta.url),
  "utf8",
);


test("a topology node opens a session-scoped side-panel selection", () => {
  assert.match(transcriptSource, /const openSubagentPanel = useAppStore\(\(s\) => s\.openSubagentPanel\)/);
  assert.match(transcriptSource, /const panelSelectionId =/);
  assert.match(transcriptSource, /openSubagentPanel\(panelSelectionId\)/);
  assert.match(transcriptSource, /aria-controls=\{hasDetails \? "subagent-panel" : undefined\}/);
  assert.match(transcriptSource, /variant !== "topology" && open/);
  assert.match(transcriptSource, /variant !== "topology" && open && hasDetails/);
  assert.match(storeSource, /subagentPanel: SubagentPanelSelection \| null/);
  assert.match(storeSource, /openSubagentPanel:\s*\(delegationId\) => \{/);
  assert.match(storeSource, /set\(\{ subagentPanel: \{ sessionId, delegationId: id \} \}\)/);
  assert.match(storeSource, /closeSubagentPanel: \(\) => set\(\{ subagentPanel: null \}\)/);
  assert.match(storeSource, /if \(state\.subagentPanel\) \{/);
  assert.match(storeSource, /state\.closeSubagentPanel\(\)/);
  assert.match(storeSource, /if \(get\(\)\.workPanelOpen\) get\(\)\.collapseWorkPanel\(\)/);
});

test("the side panel re-finds live rows instead of storing a stale render snapshot", () => {
  assert.match(panelSource, /buildTranscriptEntries\(messages\)/);
  assert.match(panelSource, /selection\.delegationId/);
  assert.match(panelSource, /retainedTranscripts\[selection\.sessionId\]/);
  assert.match(panelSource, /collectDelegationStatuses\(selected\.turnActivityItems/);
  assert.match(panelSource, /collectDelegationTimings\(selected\.turnActivityItems\)/);
  assert.match(panelSource, /<SubagentDetail/);
  assert.match(panelSource, /data-testid="subagent-panel"/);
  assert.match(panelSource, /selected\.item\.message/);
});

test("the work-panel dock hosts subagent details without creating a resource tab", () => {
  assert.match(workPanelSource, /subagentPanel\?: SubagentPanelSelection \| null/);
  assert.match(workPanelSource, /onCloseSubagentPanel\?: \(\) => void/);
  assert.match(workPanelSource, /\{subagentPanel \? \(/);
  assert.match(workPanelSource, /<SubagentPanel selection=\{subagentPanel\} \/>/);
  assert.match(workPanelSource, /activeTab && !subagentPanel/);
  assert.match(workPanelSource, /subagentPanel && onCloseSubagentPanel/);
  assert.match(appSource, /const subagentPanelOpen = Boolean\(/);
  assert.match(appSource, /page === "chat"/);
  assert.match(appSource, /page !== "chat" \|\| subagentPanel\.sessionId !== activeSessionId/);
  assert.match(appSource, /workPanelOpen \|\| subagentPanelOpen/);
  assert.match(appSource, /subagentPanel=\{subagentPanelOpen \? subagentPanel : null\}/);
  assert.match(workPanelSource, /if \(subagentPanel\) setContextOpen\(false\)/);
});

test("the side-panel body scrolls while the conversation keeps its own layout", () => {
  assert.match(workPanelCss, /\.subagent-panel \{[^}]*flex: 1/);
  assert.match(workPanelCss, /\.subagent-panel-scroll \{[^}]*overflow-y: auto/);
  assert.match(workPanelCss, /\.subagent-detail \.subagent-run \{[^}]*margin: 12px 0 0/);
  assert.match(workPanelCss, /\.subagent-detail \.subagent-run-rows \{[^}]*max-height: min\(520px, 58dvh\)/);
});
