# Verification report

Verified on September 14, 2026. No final two-person demo, production execution, or load-test claim is made for Milestone 0.

## Environment

Node 24 on Windows. Docker Desktop was not present on the authoring machine. Local migration/constraint tests therefore use PostgreSQL WASM; GitHub Actions is configured to repeat SQL tests on PostgreSQL.

## Scope

| Check                                                     | Observed result |
| --------------------------------------------------------- | --------------- |
| Formatting and ESLint                                     | Passed          |
| Strict TypeScript and generated Next.js route types       | Passed          |
| Prisma schema validation and client generation            | Passed          |
| Unit tests                                                | 18 passed       |
| PostgreSQL WASM migration/constraint tests                | 6 passed        |
| Next.js production build                                  | Passed          |
| Playwright foundation browser test using installed Chrome | 1 passed        |
| Compose YAML and local exposure checks                    | Passed          |
| Visual inspection of the landing page                     | Passed          |

The SQL tests verify seat limits, unique seats, immutable/source-size-constrained snapshots, execution idempotency, cross-room snapshot rejection, hidden-output rejection, and test/problem version consistency. They do not yet exercise application authorization or real simultaneous joins.

Node 24 runs the standalone TypeScript infrastructure scripts directly. This avoids a `tsx` OS-user lookup failure observed in the restricted Windows authoring environment. Next.js generates its own environment and route declaration files before type checking; generated files are not committed.

## Not yet verified

- Docker Compose startup and the exact container tags: Docker is not installed locally. An actual image pull and startup check remains necessary.
- GitHub Actions on real PostgreSQL: the workflow is provided, but a passing cloud run is not claimed until observed.
- Real Clerk sessions, authenticated shared editing, sandbox execution, and performance targets: these features belong to later milestones.

## External dependencies not configured

Clerk development credentials, separate sandbox API, and Docker runtime. Authentication, collaboration, execution and production deployment are later milestones.
