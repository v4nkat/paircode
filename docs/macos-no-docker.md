# Two-person local demo on macOS (no Docker)

This runs the web app, PostgreSQL, Redis, and the collaboration relay on one Mac. It verifies sign-in, rooms, invitations, and shared editing. It **does not** run submitted Python: keep `EXECUTION_ENABLED=false` until a separately isolated Judge0 service has been configured and tested as described in [execution.md](execution.md).

## 1. Install and start local services

Install [Node.js 24](https://nodejs.org/en/download) and [Homebrew](https://brew.sh/) if they are not already installed. The repository requires pnpm 11.19.0. In Terminal:

```bash
node --version # must start with v24.
brew install postgresql@17 redis
brew services start postgresql@17
brew services start redis
"$(brew --prefix postgresql@17)/bin/pg_isready" -h 127.0.0.1
redis-cli ping # should print PONG
npm install --global pnpm@11.19.0
```

Homebrew installs PostgreSQL 17's command-line tools outside the default `PATH`. Use the full paths below. If `pg_isready` reports that port 5432 is unavailable or occupied by another PostgreSQL instance, resolve that before applying migrations.

## 2. Create a local database

Open PostgreSQL's interactive shell:

```bash
"$(brew --prefix postgresql@17)/bin/psql" postgres
```

At the `postgres=#` prompt, run the following lines one at a time. `\password` prompts privately; choose a long, randomly generated password using only letters and numbers so it can go directly in a connection URL.

```sql
CREATE ROLE paircode LOGIN;
\password paircode
CREATE DATABASE paircode OWNER paircode;
\q
```

If the role or database already exists, do not recreate it. Check the existing local setup or use different names. Confirm the credentials from Terminal without putting the password into shell history:

```bash
"$(brew --prefix postgresql@17)/bin/psql" -h 127.0.0.1 -U paircode -d paircode -W -c 'select current_user;'
```

## 3. Install PairCode and configure ignored local files

Clone the [public repository](https://github.com/v4nkat/paircode) if needed, then install its pinned dependencies:

```bash
git clone https://github.com/v4nkat/paircode.git
cd paircode
pnpm install --frozen-lockfile
pnpm db:generate
cp .env.example .env
```

Edit the root `.env`. Set `DATABASE_URL=postgresql://paircode:YOUR_LOCAL_PASSWORD@127.0.0.1:5432/paircode`, `REDIS_URL=redis://127.0.0.1:6379`, and `APP_ORIGIN=http://localhost:3000`. Generate a relay secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and put it in `COLLABORATION_CONTROL_SECRET`. Leave `EXECUTION_ENABLED=false` and all `SANDBOX_*` values blank. The `POSTGRES_*` fields in this file are only used by Docker Compose; they do not create or change a Homebrew database.

Create `apps/web/.env.local` with these lines, filling in the same database URL and relay secret. Get the Clerk **development** keys from your application's API Keys page in the [Clerk dashboard](https://dashboard.clerk.com); do not paste the secret key into chat or commit it.

```dotenv
DATABASE_URL=postgresql://paircode:YOUR_LOCAL_PASSWORD@127.0.0.1:5432/paircode
REDIS_URL=redis://127.0.0.1:6379
APP_ORIGIN=http://localhost:3000
NEXT_PUBLIC_COLLABORATION_URL=ws://localhost:1234
COLLABORATION_INTERNAL_URL=http://127.0.0.1:1234
COLLABORATION_CONTROL_SECRET=YOUR_GENERATED_RELAY_SECRET
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=YOUR_CLERK_DEVELOPMENT_PUBLISHABLE_KEY
CLERK_SECRET_KEY=YOUR_CLERK_DEVELOPMENT_SECRET_KEY
EXECUTION_ENABLED=false
```

Both files are Git-ignored. Keep the URLs and relay secret identical across the two files, and always open the app at **http://localhost:3000** rather than switching between `localhost` and `127.0.0.1` in the browser.

Validate configuration and initialize the database:

```bash
pnpm env:check
pnpm env:check web
pnpm db:migrate
pnpm db:seed
```

## 4. Run and verify the demo

In one Terminal tab run `pnpm dev:collaboration`; in another run `pnpm dev`. Check `http://localhost:1234/healthz` and `http://localhost:3000/api/ready`, then visit `http://localhost:3000`.

Use two browser profiles with two distinct Clerk accounts. Sign in as the first person, create a room, copy its invitation, and join from the second profile. Type in both editors, check that both cursors and edits appear, wait for **Saved**, then reload to verify the source remains. Follow the full [two-person checklist](auth-setup.md#two-person-verification), including the third-account rejection and invitation rotation.

This is a local demo on your Mac; a partner on another computer cannot reach `localhost`. For a remote/public demo, deploy the services with HTTPS/WSS and a suitable database, Redis, and isolated execution service. Do not expose the Homebrew development services or the Clerk development instance as a public deployment.
