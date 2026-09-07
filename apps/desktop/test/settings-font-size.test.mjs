import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const rowSource = await readFile(
  new URL("../src/components/settings/FontSizeRow.tsx", import.meta.url),
  "utf8",
);
const appSource = await readFile(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);
const settingsPageSource = await readFile(
  new URL("../src/pages/SettingsPage.tsx", import.meta.url),
  "utf8",
);
const tokensSource = await readFile(
  new URL("../src/styles/tokens.css", import.meta.url),
  "utf8",
);
const styles = await loadStyles();

test("Appearance card renders a font-size row after the font family picker", () => {
  const generalStart = settingsPageSource.indexOf(
    '{tab === "general" && settings && (',
  );
  const aiStart = settingsPageSource.indexOf('{tab === "ai" && settings && (');
  const generalSource = settingsPageSource.slice(generalStart, aiStart);
  const fontFamily = generalSource.indexOf("<FontFamilyRow ");
  const fontSize = generalSource.indexOf("<FontSizeRow ");
  assert.ok(fontFamily >= 0);
  assert.ok(fontSize > fontFamily);
});

test("presets and custom px persist AppSettings.fontSize", () => {
  assert.match(rowSource, /saveSettings\(\{ fontSize: size \}\)/);
  assert.match(rowSource, /MIN_READING_FONT_SIZE/);
  assert.match(rowSource, /MAX_READING_FONT_SIZE/);
  assert.match(rowSource, /settings\.fontSizeSmall/);
  assert.match(rowSource, /settings\.fontSizeDefault/);
  assert.match(rowSource, /settings\.fontSizeLarge/);
  assert.match(rowSource, /settings\.fontSizeXl/);
});

test("the renderer applies the reading size without a reload", () => {
  assert.match(appSource, /normalizeReadingFontSize\(settings\?\.fontSize\)/);
  assert.match(appSource, /"--reading-font-size"/);
  assert.match(tokensSource, /--reading-font-size:\s*14px;/);
  assert.match(tokensSource, /\.thread-wrap,\s*\n\.composer-dock \{/);
  assert.match(tokensSource, /--text-base:\s*var\(--reading-font-size\);/);
});

test("font-size control keeps presets and the custom field stacked", () => {
  assert.match(styles, /\.settings-font-size\s*\{[^}]*flex-direction:\s*column;/s);
  assert.match(styles, /\.settings-font-size-custom\s*\{/);
  assert.match(styles, /\.settings-font-size-suffix\s*\{[^}]*font-size:\s*var\(--text-sm\);/s);
});
