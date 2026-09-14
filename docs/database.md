# Database guarantees

All tables contain durable state. Socket connections, awareness, cursors, and connection tickets are ephemeral. `lastSeenAt` is approximate presence history, not authorization.

| Entity              | Purpose and important relationships                                             |
| ------------------- | ------------------------------------------------------------------------------- |
| User                | Clerk subject and display name; no passwords                                    |
| Room                | Owner, versioned problem selection, revision, hashed invite and expiry          |
| RoomMember          | Two permanent member seats per room; composite room/user identity               |
| Problem             | Immutable published problem version and comparator identifier                   |
| TestCase            | Versioned visible/hidden inputs and expected values                             |
| RoomDocument        | Serialized current Yjs state and persistence revision                           |
| CodeSnapshot        | Immutable run/checkpoint/end source tied to room and problem                    |
| Execution           | Immutable request identity plus mutable lifecycle, dispatch and lease state     |
| ExecutionTestResult | Per-case progress, bounded visible output, private sandbox token                |
| RoomEvent           | Typed lifecycle events with allowlisted metadata and optional deduplication key |

The SQL migration adds constraints beyond Prisma's basic field definitions:

- Seats must be 1 or 2, with a unique slot per room.
- Execution snapshots must match the execution's room and problem version.
- Test results must match both execution and test-case problem versions.
- Source size is measured as UTF-8 bytes and capped at 64 KiB.
- Python is the only accepted language.
- Problem versions, test definitions, and source snapshot contents cannot be updated in place. Publish a new version instead.

Common history queries use `(roomId, timestamp, id)` indexes and stable cursors. Membership lookups start with user ID. Dispatch recovery indexes filter by dispatch/lifecycle state, and stalled-job recovery uses lease expiry.

The application must still check authorization, room status, ownership, request limits, and selection revisions in transactions. A unique seat does not automatically authenticate someone.

## Retention policy planned for Milestone 5

Retain ended rooms and their review data for 90 days. Preserve all snapshots referenced by retained executions. Prune unreferenced checkpoints earlier. Retain problem/test versions while referenced. Delete raw sandbox artifacts within 24 hours where supported. Keep sanitized operational logs for 14 days. Account removal must explicitly delete or anonymize cross-room references in a reviewed transaction; no deletion endpoint exists in Milestone 0.

## Test engines

Local constraint tests use PGlite's actual PostgreSQL WASM engine when Docker is unavailable. CI uses the same SQL against PostgreSQL. This tests migration syntax and constraints, not Prisma query integration or production concurrency. Actual competing-join and Prisma transaction tests belong in Milestone 1.
