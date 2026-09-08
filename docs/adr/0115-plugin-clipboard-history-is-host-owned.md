# ADR 0115: Keep plugin clipboard history host-owned and in memory

- Status: Accepted (Implemented 2026-08-21)
- Date: 2026-08-21
- Related: Issue #9, ADR 0008, ADR 0059

## Context

Plugins can read and write the current clipboard, but a plugin process has no
Electron clipboard access. Clipboard-history plugins therefore poll
`readText()` and maintain a second store, which misses fast copies and cannot
capture images. The host already runs in the Electron main process and owns the
native clipboard boundary.

Clipboard history is also more sensitive than the current clipboard: it may
retain screenshots, credentials, or private documents. Giving each plugin its
own recorder would duplicate data, make retention inconsistent, and weaken the
permission boundary.

## Decision

The Electron main process maintains one rolling, in-memory history and exposes
it to plugins as `pi.clipboard.getHistory()`. The API reuses `clipboard.read`,
returns newest-first text and image entries, and audits every call with the
entry count. Plugin processes receive only the typed result over the existing
broker; they do not receive Electron objects or a new capability.

The host samples the system clipboard every 500ms because Electron has no
cross-platform change event. The first sample after startup establishes a
baseline. Host writes are recorded immediately. Consecutive identical content
is collapsed with a refreshed timestamp. Slow samples (especially
`clipboard.readImage()` + `toPNG()` on a screenshot) are recorded on
`app/timing.log` as `[timing] kind=clipboard` with encode timings and byte
size, never payload contents.

The history is cleared on application exit and is bounded to:

- 30 days retention;
- 500 entries and 256 MiB total payload;
- 100 KiB of UTF-8 text or 50 MiB of PNG image bytes per entry.

Images are normalized to PNG with width and height, so the plugin contract is
stable across operating systems and source clipboard formats.

## Consequences

- Clipboard-history plugins no longer need a polling loop or a local duplicate
  store, and image entries cross the process boundary as `Uint8Array` data.
- Content copied before the app starts is not recoverable, and an OS clipboard
  copy that begins and ends between samples cannot be observed. A future native
  change-notification integration can improve capture fidelity without changing
  the plugin API.
- The history is intentionally not persisted. This limits privacy exposure and
  avoids making clipboard content part of the host database or plugin storage.
- `clipboard.read` permission copy explicitly includes retained history, and
  permission denial remains enforced by the existing runtime gateway.
