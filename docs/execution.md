# Python execution

Milestone 3 implementation is available locally. Live Redis delivery and a real Judge0 deployment still need verification. The tests use a PostgreSQL-compatible database and controlled sandbox responses; they do not establish that an external sandbox is securely deployed.

## Start the services

Complete the authentication and collaboration setup first. Start PostgreSQL and Redis using the existing development Compose file, apply migrations, and seed the problem catalog.

Configure the root `.env` with `DATABASE_URL`, `REDIS_URL`, `SANDBOX_API_URL`, `SANDBOX_AUTH_TOKEN`, and the Python language ID from your Judge0 deployment. The worker also reads the CPU, wall-time, and memory limits documented in `.env.example`.

Use a separately administered, authenticated Judge0 installation with isolation and network restrictions enforced by its operator. PairCode requests network-disabled execution and resource limits on each submission. Do not run submitted programs in the web server or worker process.

Set `EXECUTION_ENABLED=true` and `REDIS_URL` in `apps/web/.env.local`. Sandbox credentials belong only to the worker. Start the app, collaboration relay, and `pnpm dev:worker` in separate terminals. Restart the app after changing environment variables.

Open a room, wait for the editor to connect, and select **Run Tests**. The room lists recent attempts and shows visible test output plus an aggregate hidden-test score. With execution disabled, submitting a run explains that the service is not configured.

## Recovery and privacy

The API commits an immutable source snapshot and execution record before dispatch. An idempotency key reuses that execution after a lost response. PostgreSQL enforces six submissions per user and ten per room per minute. The API waits at most three seconds for dispatch; the worker rescans durable pending records every five seconds.

Worker leases prevent stale workers from committing results. Transient infrastructure failures allow up to three attempts. A persisted Judge0 token is polled again after a retry instead of resubmitted. A crash between external submission and saving its token can still duplicate sandbox work: delivery is not exactly once.

Expected answers stay in the worker/database. Hidden stdout and stderr are discarded before persistence and excluded again from public results. Visible output is bounded and rendered as text. Judge0 time-limit, compilation, and runtime statuses are distinguished; a runtime failure is not assumed to be a memory-limit failure.

## Verification still needed

- Redis/BullMQ dispatch, retry, and worker restart checks run in CI. Live deployment recovery after an outage remains to be checked.
- Real Judge0 passing, wrong-answer, syntax-error, timeout, and unavailable-service runs.
- Two signed-in users submitting and reviewing attempts in a deployed room.
- The browser component harness covers Run Tests, retry after a lost response, snapshots, and review. A signed-in end-to-end browser check remains.

Run `pnpm test:unit`, `pnpm test:integration`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` for the automated checks available now.
