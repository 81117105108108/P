# ADR 0180: Custom reading font size

- Status: Accepted
- Date: 2026-09-08
- Baseline: `0.4.16`
- Protocol: unchanged (renderer-owned `AppSettings` JSON field)
- Storage schema: unchanged (optional `AppSettings.fontSize`)
- Related: D343, ADR 0083, `04-ux/06-settings-ia.md`,
  `04-ux/07-ui-design-system.md`

## Context

Chat transcript and composer sizes come from a frozen `--text-*` ramp
(`--text-base` is 14px). The application menu exposes Zoom In / Zoom Out /
Reset Zoom, but those scale the entire window, including chrome and controls.
Users who want denser or larger reading text on a high-DPI display have no
way to change only the conversation type, and the preference is not
remembered independently of window zoom.

## Decision

1. **Settings → General → Appearance** gains a **Font size** row under Font.
   Four presets (Small 12 / Default 14 / Large 16 / Extra large 18) sit above
   a custom integer px field. Valid values are integers 12–24 inclusive.
   Absent means 14.

2. **Persistence** is optional `AppSettings.fontSize`. `settings.set` merges
   the field into the existing settings blob. Invalid writes are rejected at
   the renderer edge (`validateSettingsWrite`); reads clamp through
   `normalizeReadingFontSize`. No host protocol or storage schema version
   bump.

3. **Application** is reading-scoped. The renderer sets `--reading-font-size`
   on `document.documentElement`. `.thread-wrap` (transcript) and
   `.composer-dock` (home and docked composer) remap the `--text-*` ramp
   proportionally from that base so prose, headings, code, tool output, and
   the input keep their relative steps. Sidebar, settings, and window chrome
   stay on the product ramp.

4. **Zoom stays independent.** Menu and shortcut Zoom In / Zoom Out / Reset
   Zoom continue to scale the whole window. Reading size and zoom compose.

## Consequences

- Users can enlarge conversation text without enlarging titlebar, sidebar,
  or settings controls.
- Compact chrome hit targets are unchanged, so a large reading size cannot
  overflow 28px sidebar rows.
- The product 14px default is unchanged until the user picks another value.

## Alternatives

- **Scale every `--text-*` token on `:root`:** simpler CSS, but it enlarges
  settings, sidebar, and toolbars — the same class of problem as window zoom.
- **Zoom In/Out only:** already exists; it scales chrome together with text
  and is not a reading preference.
- **em-based transcript only:** the current ramp is px tokens; remapping the
  existing variables keeps component CSS on the token contract.
