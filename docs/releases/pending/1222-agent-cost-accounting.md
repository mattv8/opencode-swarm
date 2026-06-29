# Issue 1222: Agent Cost Accounting

Adds per-delegation token and cost fields to `delegation_end` telemetry and a new `/swarm costs` command for per-agent, per-task, per-gate, and per-retry-loop totals.

`/swarm benchmark --ci-gate` now accepts `--max-cost-usd <n>` to fail CI when cumulative telemetry cost exceeds a configured threshold. Cost estimates are optional and use `pricing.models` when providers return token usage without reported cost; missing data degrades to `cost_source: "unavailable"`.
