# Guardrail Transparency Suite — Complete

## What changed

The guardrail transparency suite (issue #1274) is now complete. Phase 1 delivered the foundation; Phase 2 completed the observability stack.

---

## Phase 1 — Foundation

### `/swarm guardrail explain` — dry-run guardrail decisions before execution

A diagnostics command that reports what the guardrail system **would** do to a given shell command or write target — without executing anything. Available to agents via `swarm_command`.

**Shell mode** (default — pass a command string):

```
/swarm guardrail explain rm -rf node_modules/
```

Returns: decision (`allow`/`block`), the firing rule, resolved scope, and detected write categories.

**Write mode** (`--write`, repeatable — inspect individual file/directory targets):

```
/swarm guardrail explain --write src/hooks/guardrails.ts --write .swarm/plan.json
```

Returns: per-target decision, firing rule, resolved scope, and zone classification for each path.

**Simulation flags:**

- `--agent <role>` — simulate guardrail decisions as if issued by a different agent role (e.g., `reviewer`, `test_engineer`)
- `--scope <path>` — simulate decisions scoped to a specific working directory

Output is advisory and fully redacted — no side effects, no writes, no process execution.

### `/swarm diagnose` — Sandbox status

`/swarm diagnose` includes a **Sandbox** health-check line reporting:

- **Executor mechanism** detected (bubblewrap / sandbox-exec / windows-runner / none)
- **Availability** of the sandbox executor
- **Whether commands are actually being sandboxed** (sandboxing / silent pass-through / none)

This is advisory only — absence of a sandbox executor never causes a hard failure.

### Unified guardrail decision-log schema (Phase 1 foundation)

The shell-audit log at `.swarm/session/shell-audit.jsonl` uses an additive type-discriminated JSONL schema. Five decision types are written to the same stream alongside existing shell entries:

- `file_write`
- `scope_violation`
- `destructive_block`
- `sandbox_wrap`
- `sandbox_skip`

---

## Phase 2 — Decision-Log Reader and Full Capture

### `/swarm guardrail-log [--blocks-only]`

A new diagnostics command that reads the unified guardrail decision log (`.swarm/session/shell-audit.jsonl`) and prints entries most-recent-first. Agent-callable via `swarm_command`.

```
/swarm guardrail-log
/swarm guardrail-log --blocks-only
```

**`--blocks-only`** filters to show only block decisions (`file_write`, `scope_violation`, `destructive_block`). Legacy shell command entries and sandbox wrap/skip entries are excluded.

**Output characteristics:**

- Entries are sorted most-recent-first
- Commands and paths are redacted in output
- If no log file exists yet, prints a friendly message: "No guardrail decisions recorded yet."
- On-demand only — no hot-path cost; reads the log file only when the command is invoked

**Example output:**

```
=== Guardrail Decision Log ===
2026-06-20T10:42:01.000Z  destructive_block  rm -rf node_modules/
2026-06-20T10:41:55.000Z  file_write         src/hooks/guardrails.ts
2026-06-20T10:41:48.000Z  scope_violation    ./src/secrets.json

No guardrail decisions recorded yet.
```

### Unified decision-log capture (internal)

The guardrail hook now records **all** decision types — file-write blocks, scope violations, destructive-command blocks, sandbox wraps, and sandbox skips — to the unified log. Each entry is redacted before writing. Blocking behavior is unchanged; the capture is purely additive observability.

This completes the unified guardrail decision log capability from issue #1274: the schema was introduced in Phase 1, and the full capture wiring + reader command landed in Phase 2.

## Complete suite at a glance

| Capability | Status | Notes |
|---|---|---|
| `guardrail explain` dry-run | ✅ Phase 1 | Shell + write modes, simulation flags |
| Sandbox status in `diagnose` | ✅ Phase 1 | Executor, availability, enforcement |
| Unified log schema | ✅ Phase 1 | Five new decision types in JSONL |
| `guardrail-log` reader | ✅ Phase 2 | Most-recent-first, `--blocks-only`, redacted |
| Full capture wiring | ✅ Phase 2 | All decision types now logged |

## Why

Guardrail decisions were previously opaque — agents and users had no reliable way to predict whether a given command would be allowed, blocked, or sandboxed. The `explain` command makes guardrail behavior observable and debuggable *before* a command runs, eliminating guesswork.

The `guardrail-log` command and full capture wiring make the *history* of decisions observable *after* the fact, completing the observability loop: before (`explain`), during (logging), and after (`guardrail-log`).

The Sandbox line in `diagnose` closes a visibility gap: users on Linux (bubblewrap), macOS (sandbox-exec), or Windows (windows-runner) can confirm whether their runtime is actually enforcing sandbox boundaries.

## Migration

No breaking changes. All changes are additive:

- `/swarm guardrail explain` — new command, safe to use immediately
- `/swarm diagnose` — gains a new Sandbox line; existing output unchanged
- `/swarm guardrail-log` — new command, reads existing log file
- The JSONL schema is additive only — existing log readers are unaffected
