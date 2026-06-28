# Deferred context-tool improvements (Phase 2)

## What changed

Phase 2 of issue #1388 delivers three polish improvements.

### FR-005: Structure-aware summarization

`createSummary` in `src/summaries/summarizer.ts` now produces richer, structure-aware previews instead of fixed truncation:

- **JSON objects** — shows ALL top-level keys with their TypeScript-style type signatures (e.g., `id: string, count: number, active: boolean`) rather than a fixed number of keys
- **JSON arrays** — shows the first element's type signature (e.g., `Array<{ id: string, name: string }>`)
- **Code outputs** — includes declaration signatures: `function`/`class`/`interface` names and their signatures
- **Plain text** — preserves leading lines up to the line limit

This gives reviewers and agents better signal about what a large output contains without needing to retrieve the full content.

### FR-006: Centralized verdict normalization

The duplicated `normalizeVerdict` logic from `write_drift_evidence`, `write_hallucination_evidence`, and `write_mutation_evidence` is now centralized in `src/evidence/normalize-verdict.ts`:

- `normalizeVerdict2` — maps `APPROVED` → `approved`, `NEEDS_REVISION` → `rejected` (used by drift and hallucination writers)
- `normalizeVerdict4` — maps `PASS/WARN/FAIL/SKIP` → `pass/warn/fail/skip` (used by mutation writer)
- Both functions are pure and throw on invalid input, matching the original per-file behavior exactly
- `_internals` DI seam allows tests to swap implementations without `mock.module` leakage

**Adding a new verdict value** now requires changing only `normalize-verdict.ts` — all three writers automatically accept it with no per-writer edits. `VERDICT_SET_2` and `VERDICT_SET_4` are the single source of truth for both Zod schemas and runtime validation.

### FR-007: Knowledge tool description clarity

`knowledge_recall` and `knowledge_query` tool descriptions now clearly differentiate their intent with cross-references:

- **`knowledge_recall`** — "Performs **semantic natural-language search**… This is the tool to use when the user has a **QUESTION** about what the knowledge base contains. For structured filter-based retrieval (by category, status, or score), use `knowledge_query` instead."
- **`knowledge_query`** — "Performs **structured filter-based retrieval**… This is the tool to use when the user knows the **CATEGORY, STATUS, or SCORE** they want to filter by. For semantic natural-language search, use `knowledge_recall` instead."

The cross-reference makes it unambiguous which tool to reach for in each situation.

## Why

- FR-005: Fixed-truncation summaries hid key fields in large JSON objects. Structure-aware previews preserve the complete schema shape so agents can reason about output completeness.
- FR-006: Three evidence writers each had their own copy of verdict normalization. Adding a new verdict (e.g., `NEEDS_DISCUSSION`) required editing all three files. Centralizing the logic makes the codebase DRY and reduces the chance of inconsistency.
- FR-007: Agents were choosing between `knowledge_recall` and `knowledge_query` based on unclear heuristics. Explicit cross-references remove the ambiguity.

## Migration notes

- FR-005: No migration needed — existing `summaries` config is unaffected
- FR-006: No migration needed — external API is unchanged; internal implementation is now shared
- FR-007: No migration needed — tool behavior is unchanged; only descriptions were clarified

## Breaking changes

None.

## Test coverage

- `tests/unit/summaries/summarizer.test.ts` — updated for structure-aware JSON/code/text preview assertions
- `tests/unit/evidence/normalize-verdict.test.ts` — unit tests for `normalizeVerdict2` and `normalizeVerdict4` including DI seam verification
- `tests/unit/tools/knowledge-recall.test.ts` — verified `knowledge_recall` description contains cross-reference
- `tests/unit/tools/knowledge-query.test.ts` — verified `knowledge_query` description contains cross-reference
