# API plan

Only `GET /api/health` is implemented in Milestone 0. It reports service health, not database/sandbox readiness. Everything below is an implementation contract for later milestones.

| Method and route                         | Input / output                                                                               | Authorization                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------- |
| POST /api/rooms                          | title + problemId -> room + one-time raw invite URL                                          | Signed in                                |
| GET /api/rooms                           | cursor, limit -> membership-scoped rooms                                                     | Signed in                                |
| GET /api/rooms/:id                       | room + safe problem projection                                                               | Member                                   |
| POST /api/rooms/join                     | inviteToken -> roomId + membership                                                           | Signed in; transactional seat allocation |
| POST /api/rooms/:id/invite               | rotate -> URL + expiry                                                                       | Owner                                    |
| POST /api/rooms/:id/leave                | leave active connection; retain history                                                      | Member                                   |
| POST /api/rooms/:id/end                  | freeze, flush, revoke invite                                                                 | Owner                                    |
| PATCH /api/rooms/:id/problem             | problemId + expected selection revision                                                      | Active member                            |
| POST /api/rooms/:id/executions           | sourceCode + python + problemId + selectionRevision; Idempotency-Key header -> 202 ID/status | Active member; rate limits               |
| GET /api/rooms/:id/executions            | cursor + limit -> summaries                                                                  | Member                                   |
| GET /api/executions/:id                  | status + safe visible results + aggregate hidden summary                                     | Execution's room member                  |
| GET /api/rooms/:id/review                | stable chronological timeline                                                                | Member                                   |
| GET /api/rooms/:id/snapshots/:snapshotId | source and metadata                                                                          | Member; validate both IDs                |
| POST /api/rooms/:id/collaboration-ticket | single-use room-bound ticket                                                                 | Active member                            |

Validate all bodies, paths and queries. Never trust client-supplied user IDs, tests, expected answers, or execution limits. Missing/non-member room access returns 404. Unauthenticated API access returns 401. Owner-only actions return 403 for an existing member, malformed requests 422, oversized bodies 413, conflicts 409, and rate limits 429 with Retry-After.

Error envelope: `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`. Protected reads must not be shared-cacheable. Browser mutations verify the expected origin.

WebSocket authorization precedes document loading and synchronization. Single-use tickets expire, are refreshed on reconnect, and are excluded from logs. Recheck membership and room state periodically and close revoked/ended connections. The default y-websocket server is not sufficient authorization by itself.
