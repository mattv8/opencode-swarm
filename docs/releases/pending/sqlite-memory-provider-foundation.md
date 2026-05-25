---
title: SQLite memory provider foundation
category: added
---

## Summary

Adds an opt-in SQLite memory provider behind the existing memory gateway/provider seam. `local-jsonl` remains the default provider, so existing agent prompts and default behavior are unchanged.

## Details

- Added `memory.provider: "sqlite"` with `memory.sqlite.path` and `memory.sqlite.busyTimeoutMs` settings.
- Added SQLite provider parity for memory items, proposals, recall usage, and provider events under `.swarm/memory/memory.db`.
- Kept the Bun SQLite driver lazily resolved when the SQLite provider initializes so the Node-compatible plugin bundle remains loadable when SQLite is not selected.

## Migration

No migration is required. Existing memory storage remains local JSONL unless users explicitly set `memory.provider` to `"sqlite"`.
