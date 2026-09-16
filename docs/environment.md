# Environment configuration

`.env.example` contains placeholders only. The root `.env` is ignored by Git and read by Prisma tooling and environment-check scripts. Next.js does not automatically load the repository root environment when its app directory is `apps/web`; put web-specific settings in ignored `apps/web/.env.local` for later milestones.

| Variable                                                     | Consumers                                             | Visibility                                 |
| ------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------ |
| POSTGRES_USER, POSTGRES_DB, POSTGRES_PASSWORD                | Local Compose                                         | Server/local only                          |
| DATABASE_URL                                                 | Database tooling, web/collaboration and future worker | Server-only secret                         |
| REDIS_URL                                                    | Web/collaboration and future worker                   | Server-only secret if authenticated        |
| APP_ORIGIN                                                   | Protected browser operations                          | Configuration                              |
| NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY                            | Web                                                   | Public key, intentionally browser-visible  |
| CLERK_SECRET_KEY                                             | Web server                                            | Secret                                     |
| NEXT_PUBLIC_COLLABORATION_URL                                | Web                                                   | Public WebSocket address                   |
| COLLABORATION_HOST, COLLABORATION_PORT                       | Collaboration                                         | Bind configuration                         |
| SANDBOX_API_URL, SANDBOX_AUTH_TOKEN                          | Worker only                                           | Server-only                                |
| SANDBOX_PYTHON_LANGUAGE_ID                                   | Worker only                                           | Read from chosen deployment, never guessed |
| SANDBOX_CPU_SECONDS, SANDBOX_WALL_SECONDS, SANDBOX_MEMORY_KB | Worker only                                           | Proposed enforced limits                   |
| TEST_DATABASE_URL                                            | Integration tests                                     | Disposable PostgreSQL only                 |

`pnpm env:check` validates infrastructure. `pnpm env:check web` and `pnpm env:check worker` validate future process settings. Validation errors report field names, not rejected values. The public landing page needs none of these credentials.

Set `PLAYWRIGHT_CHANNEL=chrome` for a local E2E run using installed Chrome. Omit it to use Playwright Chromium, as CI does.

Clerk credentials, sandbox configuration, and installed Docker are not supplied by this repository. No account, paid subscription, or remote sandbox is created automatically.

Shared editing also requires server-only COLLABORATION_INTERNAL_URL and COLLABORATION_CONTROL_SECRET (at least 32 characters). See [collaboration setup](collaboration.md).
