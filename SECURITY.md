# Security and threat model

## Current state

Milestone 0 is a public foundation preview. It has no submission endpoint, no authentication flow, no open Yjs relay, and no execution consumer. The collaboration health process refuses WebSocket upgrades. The worker exits rather than pretend to execute jobs.

Do not treat the project as a production code runner. The following controls are requirements for later milestones, not claims of completed implementation.

## Assets and trust boundaries

Assets: session source, room history, identity, invite/connection tokens, hidden tests, database credentials, sandbox credentials. Untrusted sources: browser payloads, awareness messages, submitted Python, sandbox stdout/stderr, and external service responses.

| Threat                                           | Required control and verification                                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Non-member reads a room or execution             | Membership checks on every route/socket; negative integration tests                                                         |
| Third participant races to join                  | Room lock plus database seat constraints; competing-join test                                                               |
| Invite theft or replay                           | Random tokens, hashes in DB, expiry/rotation, redacted logs, signed-in join                                                 |
| Hidden inputs printed into output                | Never return hidden stdout/stderr, traces, expected values or submission tokens; explicit public DTO                        |
| Infinite loops, fork/output bombs, network abuse | Isolated patched execution host; verified CPU/wall/memory/process/file/output limits; outbound network disabled             |
| Sandbox escape                                   | Separate host/VM or suitable maintained service, no host mounts/application secrets; current patch review and failure tests |
| Duplicate delivery or worker crash               | Durable pending dispatch, job IDs, leases, recorded tokens, idempotent result writes                                        |
| HTML/terminal injection                          | Plain-text output rendering, size limits, no raw HTML output                                                                |
| Spoofed presence                                 | Bind participant identity to authorized socket, never use awareness for permission                                          |
| Leaked configuration                             | Process-scoped secrets, ignored env files, server-only imports, safe validation errors                                      |

## Hidden means hidden from the application UI/API

The repository is public. Its fixed seed fixtures can be read in source, so they are not confidential assessment material. Runtime response privacy still matters and is tested. A future private catalog must be injected through server-only storage and omitted from the public repository. A program necessarily observes its own input; even aggregate verdicts can be used for inference over repeated runs.

## Sandbox requirements

Never execute user code inside Next.js, the queue worker, or a normal application Docker container. Only the sandbox service executes it. The worker may access DB/Redis to manage orchestration; none of those credentials enter the executed program.

Judge0's documented status list has no distinct memory-limit verdict. Only label memory exhaustion when the selected deployment provides reliable evidence. Do not classify every SIGKILL or runtime failure as a memory limit. Verify Python syntax-error mapping too.

Proposed per-case limits are 2 CPU seconds, 10 wall seconds, and 128 MiB. Actual sandbox settings, process/file/output caps, network isolation and enforcement remain to be validated. Public execution stays disabled until validated.

## Reporting

Do not post credentials, user source, or exploitable details in a public issue. For this pre-release project, report a minimal non-sensitive description privately to the repository owner where a private channel is available. No production service or bug-bounty program is offered.
