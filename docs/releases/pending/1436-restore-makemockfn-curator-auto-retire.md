# Restore makeMockFn pattern in curator-auto-retire tests

## What changed

- Restored the `makeMockFn` call-recording helper in
  `tests/unit/hooks/curator-auto-retire.test.ts` and removed the `mock` import
  from `bun:test`.
- Converted all `mock(() => ...)` instantiations to `makeMockFn(() => ...)`
  and migrated assertions from `toHaveBeenCalledTimes` / `toHaveBeenCalledWith` /
  `not.toHaveBeenCalled` to the helper's `.calls` array
  (`toHaveLength` / `toEqual`).
- Updated the file header comment to accurately describe the isolation
  mechanism (`mock()` internal-state leakage, not just `mock.module()`).
- Added a regression test locking in the `makeMockFn` call-recording contract.

## Why

PR #1325 reintroduced `bun:test`'s `mock()` into this test file, undoing the
prior CI-pollution fix. Bun's `mock()` retains internal mock-tracking state that
can leak across test files in the shared test-runner process (AGENTS.md
invariant 7). The `_internals` DI seam protects production-code references but
not Bun's internal mock object state, so `mock()` reintroduces a latent
cross-file pollution surface. `makeMockFn` records calls without registering a
Bun mock, eliminating that surface while preserving identical assertion
capability.

## Impact

- Eliminates the latent cross-file mock-state leakage from
  `curator-auto-retire.test.ts`.
- All 9 existing test cases continue to pass (behavior-equivalent conversion);
  3 consecutive runs show no flakiness.
- Adds 2 regression tests covering the `makeMockFn` contract.

## Migration

No migration required — test-only change.

## Breaking changes

None.
