# Room workflow verification

September 15, 2026. This report covers room creation and membership, not collaboration or execution.

## Local results

- Formatting, ESLint, strict TypeScript, and the Next.js production build passed.
- 32 unit and integration tests passed. One additional competing-join test is reserved for PostgreSQL in CI.
- Two browser tests passed against the production build using Chrome: the landing page and the unconfigured authentication/API behavior.
- Invitation tests cover hashing, expiry, rotation, duplicate joins, a full room, and revocation on ending.
- Authorization tests cover member-scoped room lists, non-member room reads, and owner-only operations.
- HTTP tests cover missing authentication, cross-origin mutations, unknown input fields, oversized bodies, and private caching.

## Remaining verification

The [September 15 CI run](https://github.com/v4nkat/paircode/actions/runs/35022012045) passed, including the competing-join test on independent PostgreSQL connections. PR #1 was merged on September 16.

Live Clerk sign-in and the complete two-account browser workflow require development credentials and a configured database. The manual checklist is in [auth-setup.md](auth-setup.md). The tests inject authentication into the HTTP handler in test code; the running application has no test-user or authentication-bypass flag.
