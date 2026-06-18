Fixes PRM trajectory durability, Curator recommendation retention, and `/swarm learning` timeout handling.

- PRM session trajectories now update cache only after durable disk writes, refill cache from disk on cold reads, bound cached sessions, expose path helper coverage, and reset PRM/trajectory in-memory state during `/swarm reset-session` and close/reset flows.
- Curator phase summaries now accumulate recommendations, cap retained phase digests, report malformed recommendation lines and structured JSON blocks through debug-gated logs, filter unknown knowledge IDs, and document current defaults/configuration.
- `/swarm learning` now defaults to a 30 second timeout, supports `--timeout-ms`, passes cancellation into metrics computation, and returns structured timeout output for markdown and JSON modes.
