# Connect sign-in and room storage

Room creation, invitation joining, rotation, and ending are implemented. They require a Clerk application and PostgreSQL. There is no demo authentication bypass and no need to put credentials in chat or in GitHub.

## Local configuration

1. Create a development application in the [Clerk dashboard](https://dashboard.clerk.com). Enable your preferred sign-in method. Copy its development publishable key and secret key into `apps/web/.env.local`.
2. Start PostgreSQL using the root `.env` and Compose instructions in the README, or use a development PostgreSQL service. Run `pnpm db:migrate` and `pnpm db:seed` from the repository root.
3. Add the same `DATABASE_URL` to `apps/web/.env.local`, plus `APP_ORIGIN=http://127.0.0.1:3000`. Use that exact origin in the browser. Restart `pnpm dev` after changing environment variables.

```dotenv
# apps/web/.env.local — never commit this file
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
DATABASE_URL=
APP_ORIGIN=http://127.0.0.1:3000
```

Next.js reads its environment from the web application directory. Migration and seed commands read the root `.env`. A `DATABASE_URL` in only the root file does not configure Next.js.

The publishable key is designed for browser use. The secret key and database URL stay on the server. Missing keys show a setup page; protected APIs return 503 rather than substituting a fake user.

## Two-person verification

Use separate browser profiles and separate Clerk accounts.

1. Sign in at `/sign-in`, open the dashboard, and create a room.
2. Copy the invitation and open it in the second profile. Sign in and explicitly choose **Join your partner**.
3. Refresh the first profile's participant list. Both seats should be visible.
4. Open the invitation with a third account. Joining must fail with **Both seats are taken**. Opening the room URL directly must not reveal its contents.
5. Generate a new invitation as the owner. The old link must stop working; existing membership remains valid.
6. End the room. Both members retain the problem preview, while joining and invitation rotation stop working.

This browser checklist has not yet been executed with live Clerk credentials. The integration suite tests the room service and HTTP authorization boundary independently, and CI uses separate PostgreSQL connections for competing joins.

## Implementation notes

Clerk verifies the session in Next.js proxy and server helpers. The application maps the verified Clerk subject to a local user; request bodies cannot choose a user ID. The [Clerk middleware reference](https://clerk.com/docs/reference/nextjs/clerk-middleware) documents the Next.js 16 `proxy.ts` convention.

Prisma still owns schema generation, migration and seeding. The room service uses parameterized SQL through `pg` for explicit row locks and transactions. Its small query interface also allows the same service tests to run against PostgreSQL WASM locally. This is a deliberate exception to ORM queries, not a second schema.

The invite token has 256 bits of randomness, expires after 24 hours, and is stored only as a SHA-256 hash. Links use `/join#token` so the token is not sent in the initial HTTP request. The joining page removes the fragment and keeps the token in tab-scoped session storage only for the sign-in round trip. It clears that value after joining. Links are still credentials: share them only with your partner.

Production configuration must use the deployed HTTPS origin, production Clerk keys, and the database provider's TLS configuration. Per-account and per-room request rate limits, collaboration, execution, and the final live demo remain later work.
