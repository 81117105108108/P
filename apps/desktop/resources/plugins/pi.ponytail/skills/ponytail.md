---
name: Ponytail parallel sweep
description: Fan out fast, converge on anchors. Load when a task spans several files or needs parallel searches.
---

- Batch independent calls in one message (max 6 concurrent delegates).
- Semble top-k 5 first, then sg structural, then ranged Read ±10 lines.
- Emit path:line anchors only; no full-file echoes, no re-reads.
- Wide sweep → delegate to local-scout; narrow fix → inline.
- Track DONE/PENDING/BLOCKED; never redo completed work.
