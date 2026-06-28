# Knowledge and command-safety hardening

## What

Closes the related issue cluster #1275, #1282, #1291, #1292, #1293, and #1294.

- Knowledge curator hooks now recognize the real OpenCode write shape
  (`input.tool` plus `input.args.path` / `input.args.filePath` / `input.args.file`)
  in addition to legacy top-level test shapes.
- Evidence-file curation uses the same normalized path for trigger detection,
  file loading, and idempotency, including Windows separator normalization.
- External skill validation now scans markdown prose and code separately:
  benign command examples in code remain allowed, but destructive root, home,
  system, and `.swarm` targets are still blocked inside code fences and inline
  code.
- Added deterministic, seedable property-style tests for shell write detection
  and destructive-command guardrails.
- Added a safe-test-directory regression for the empty-path/dirname failure shape
  that previously made recursive cleanup unsafe under mock leakage.

## Why

These issues all sit on the same safety boundary: knowledge ingestion should run
on production-shaped hook inputs, validators should not confuse benign command
examples with instructions while still catching destructive examples, and tests
that exercise destructive command detection must be deterministic and bounded.

## Migration

No migration required.
