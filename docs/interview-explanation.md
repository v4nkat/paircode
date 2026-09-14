# Explain the project in an interview

Start by stating the implementation milestone honestly. The current release establishes a tested foundation; the collaboration and execution design below is not yet a running feature.

## Why a CRDT?

Two clients may insert or delete text before they see the other's changes. Yjs represents updates so replicas can merge them and eventually agree despite order differences. It does not automatically authenticate participants, persist data, or decide which problem is selected; those are application responsibilities.

## Why a queue?

Execution is slower and less predictable than an HTTP request. The route records an accepted attempt, the queue applies backpressure, and a worker performs the slow work. A queue does not automatically make database writes and sandbox calls atomic. We need durable dispatch recovery and idempotent state changes.

## Why separate execution?

The submitted Python is an adversarial program, not application logic. Running it with the worker's environment would expose database credentials and the host. A patched isolated execution service provides a distinct boundary with resource and network limits. Containers used for local app development are not a substitute for that design.

## Why PostgreSQL and Prisma?

Membership, immutable problem versions and execution histories have explicit relationships. SQL constraints can enforce a two-seat limit or reject a snapshot from the wrong room even when application validation fails. Prisma gives readable typed queries, while reviewed SQL supplies stronger constraints where needed.

## What tradeoffs are deliberate?

- One collaboration owner simplifies persistence; it limits horizontal scaling.
- Batched snapshots reduce writes; an abrupt crash can lose unflushed edits.
- Polling is straightforward and authorized through normal APIs; it adds status latency and repeated reads.
- At-least-once processing can repeat computation; idempotency prevents duplicate logical results.
- Public seed tests are useful development fixtures, not secret assessment material.
- Twenty concurrent rooms is a measurement target, not a benchmark result.

## What should I be able to demonstrate?

Run the checks, explain a failing constraint test, show how the hidden-output filter works, and describe what remains unimplemented. As milestones land, replace design-only explanations with actual test traces, measured failure recovery, and a live two-person demo.
