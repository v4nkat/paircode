# Performance evidence plan

No benchmark results are claimed yet. The milestone 0 performance command exits nonzero with this explanation.

After real collaboration and execution work, implement a bounded load driver and expose it as `pnpm test:performance`. It must accept a staging URL and explicit test-user identities. Never run it against an arbitrary public service.

## Workloads

1. Twenty rooms, two authenticated clients per room, realistic edit bursts for five minutes.
2. Disconnect and reconnect a subset during edits; compare serialized document contents after convergence.
3. Submit bounded runs from both members, respecting configured rate limits; measure queue wait separately from sandbox time.
4. Seed at least 100 execution attempts per room and measure initial review page and pagination.
5. Stop a worker between dispatch, sandbox submission, token persistence, and terminal result persistence. Account for every accepted execution.

## Measurements

Record CPU/RAM, OS, runtime and service versions, region/network, worker concurrency, test count, warmup, sample count, and commit SHA. Report p50/p95 queue wait, worker duration, sandbox duration, accepted-request latency, visible edit latency, infrastructure completion success, reconnect recovery success, and history-query latency.

A user's incorrect solution is not an infrastructure failure. Include censored/timed-out runs in failure accounting instead of quietly excluding them. Simulated traffic is not real user adoption. Publish scripts and raw aggregate measurements without source, tokens, or private test data.
