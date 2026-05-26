---
"opencode-swarm": minor
---

Add SQLite FTS5-backed hybrid memory recall. SQLite memory now maintains an optional FTS shadow index over memory text, tags, kind, source file/ref, symbols, and files; recall falls back to the existing scorer if FTS is unavailable.
