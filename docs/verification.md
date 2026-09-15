# Verification report

Local checks passed on September 14, 2026. The first complete GitHub Actions run passed on September 15, 2026. No final two-person demo, production execution, or load-test claim is made for Milestone 0.

## Environment

Node 24 on Windows for local checks and Ubuntu for GitHub Actions. Docker Desktop was not present on the authoring machine. Local migration/constraint tests therefore use PostgreSQL WASM; GitHub Actions repeated SQL tests against PostgreSQL 17.9 in a service container.

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

- Full Docker Compose startup, including Redis and the collaboration image: Docker is not installed locally. The PostgreSQL image was pulled and started successfully in CI, but that does not verify the full Compose stack.
- Real Clerk sessions, authenticated shared editing, sandbox execution, and performance targets: these features belong to later milestones.

## External dependencies not configured

Clerk development credentials, separate sandbox API, and Docker runtime. Authentication, collaboration, execution and production deployment are later milestones.

## Published source and CI

All 71 published files matched the local Git blob hashes after upload. [The first complete CI run](https://github.com/v4nkat/paircode/actions/runs/34990604498) passed dependency installation, formatting, lint, strict type checking, unit and PostgreSQL integration tests, the production build, and the Chromium browser smoke test. This report was then updated with that result; application code was unchanged.
