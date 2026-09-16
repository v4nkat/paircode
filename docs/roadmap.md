# Milestone roadmap

| Milestone                 | Status                                       | Definition of done                                                                                                        |
| ------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 0: foundation             | Implemented; see verification report         | Workspace, landing page, schema/migration, safe contracts, seed, infrastructure definitions, meaningful foundation checks |
| 1: identity and rooms     | Implemented; live Clerk verification pending | Clerk, transactional two-seat joining, invite rotation, membership-scoped routes and dashboard                            |
| 2: collaboration          | Implemented; live service setup pending      | Authenticated Yjs, Monaco, identity-bound presence, reconnect convergence, persistence acknowledgement                    |
| 3: execution              | Planned                                      | Python queue, durable dispatch recovery, isolated sandbox, results, retry classification and privacy                      |
| 4: experience and review  | Planned                                      | Complete room workflow, clear error/empty states, chronological paginated history                                         |
| 5: hardening and evidence | Planned                                      | Abuse tests, failure injection, two-browser E2E, measurements, deployment and demo docs                                   |
| 6: playback design        | Deferred                                     | Design only after earlier milestones work; no full keystroke event-sourcing in MVP                                        |

Security is not postponed until Milestone 5: each feature must include its authorization and data-boundary tests when introduced.

Excluded: video, voice, screen sharing, payments, matchmaking, AI feedback, multi-file editing, additional languages, and a custom CRDT or custom sandbox.
