# Shared editor: setup and verification

Milestone 2 adds an authenticated Yjs relay and a Monaco editor. Python execution and problem switching are the next milestones. Clerk's complete two-account flow still needs credentials and a manual check.

## Run locally

First complete [authentication setup](auth-setup.md). Generate a control secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Store it only in ignored environment files.

Add these settings to the root `.env` and `apps/web/.env.local`:

```dotenv
REDIS_URL=redis://127.0.0.1:6379
APP_ORIGIN=http://localhost:3000
NEXT_PUBLIC_COLLABORATION_URL=ws://localhost:1234
COLLABORATION_INTERNAL_URL=http://127.0.0.1:1234
COLLABORATION_CONTROL_SECRET=your-generated-secret
```

Keep the existing database and Clerk settings. Both processes must use the same database, Redis, origin, and control secret. Only the WebSocket address is public. The internal control URL and secret belong exclusively to the server.

```bash
docker compose --env-file .env -f infra/compose.yaml up -d postgres redis
pnpm db:migrate
pnpm db:seed
pnpm dev:collaboration
# In another terminal:
pnpm dev
```

Alternatively, start the collaboration container after migration with `docker compose --env-file .env -f infra/compose.yaml up --build -d collaboration`. Do not also run the host relay. A PostgreSQL advisory lock enforces a single relay owner. Keep this local Compose stack on loopback.

Open the exact `APP_ORIGIN`, create a room, and send its invitation to a second signed-in browser. Edits and cursors should appear in both. Wait for **Saved** before reloading or ending. Download code before leaving a tab with unconfirmed changes. Ended rooms display the last saved source.

## Why it works this way

The web server checks room membership and issues a random connection ticket. Redis stores its hash with a 30-second expiry. The relay atomically consumes it with `GETDEL`, checks the request origin and current membership, then loads the document. Reconnecting requests a fresh ticket while retaining the browser's existing Yjs document.

Yjs merges concurrent operations. PairCode does not implement a CRDT. Each problem's draft is a named `Y.Text` in the room document. Starter code is initialized by the relay and persisted before the first client synchronizes, preventing duplicated starters. The stable Yjs 13 protocol packages are used together; the newer server helper's Yjs 14 prerelease dependency was incompatible with this client stack.

Presence is ephemeral. The relay accepts cursor positions only for the ticket's client ID and supplies the authenticated user's name and seat color. Standard clients forward other users' awareness messages, so those forwarded entries are ignored. Full relative-position objects retain the null fields that y-monaco requires.

Document updates are debounced, with a five-second maximum scheduling delay while storage is healthy. Writes are serialized and coalesced. An acknowledgement includes hashes of the text actually committed. The browser shows **Saved** only when its current text matches a committed hash. PostgreSQL stores Yjs state and deduplicated code checkpoints. Ending freezes incoming edits and commits the final snapshot, status, and invite revocation together.

## Observed checks, September 16, 2026

- Five real WebSocket transport tests: simultaneous edits, offline merge, origin/auth rejection, source size rejection, and final save before close.
- PostgreSQL WASM integration tests: document restoration, deduplicated checkpoints, owner-only ending, rollback on invalid snapshots, and post-end access rejection. CI also runs these against PostgreSQL.
- Ticket unit tests: expiry, one-time consumption, wrong-room use, and hashed storage. The cache fake models Redis semantics; it does not independently verify a live Redis installation.
- A two-browser Chrome test mounts the real editor against a local relay. Both browsers type, render remote cursors, acknowledge saves, and restore source after reload with no page errors. Its test-only identity provider is outside the application and does not create an authentication bypass. The harness bundles the worker with esbuild; the separate Next.js production build verifies production bundling.
- Strict TypeScript and the production Next.js build passed. The complete local suite has 42 passing unit/integration tests and one PostgreSQL-only concurrency test skipped locally.

Run `pnpm check`, `pnpm build`, and `pnpm test:e2e`. For installed Chrome, set `PLAYWRIGHT_CHANNEL=chrome`.

## Limits that still matter

One relay owns up to 128 loaded rooms with four sockets per room (two memberships, allowing a second tab). A source is limited to 64 KiB, a serialized room document to 2 MiB, and each WebSocket message to 128 KiB. Membership is rechecked every ten seconds. Message rates and backpressure are bounded.

Unacknowledged changes live only in the open browser tab. A relay crash can lose changes since its last successful checkpoint. Closing a room cannot collect edits still disconnected on another device. The UI warns about unsaved changes and offers a source download, but this is not durable offline storage. Long-lived documents can reach their size cap because CRDT history also occupies space.

Multi-replica ownership, live Redis failure testing, a complete Clerk browser flow, deployment, and measured latency remain unverified. Do not infer those results from the component harness.
