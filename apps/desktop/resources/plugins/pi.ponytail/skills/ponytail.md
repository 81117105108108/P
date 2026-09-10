---
name: Ponytail parallel sweep
description: First-party parallel search guidance, not an upstream integration. Load when a task needs independent searches.
---

- Batch independent calls in one message (max 6 concurrent delegates).
- When available, use Semble top-k 5, then sg structural search; otherwise use the available search tools and ranged Read.
- Emit path:line anchors only; no full-file echoes, no re-reads.
- Delegate a wide sweep to local-scout only if the user has configured that subagent and its local model. Otherwise search inline; do not invent a delegate.
- Track DONE/PENDING/BLOCKED; never redo completed work.
