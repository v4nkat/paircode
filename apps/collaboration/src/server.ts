import pg from 'pg';
import { Redis } from 'ioredis';
import { createRoomStore } from '@paircode/database/room-store';
import { connectionTickets } from '@paircode/queue/tickets';
import { documentRepository } from './repository.js';
import { createRelay } from './relay.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const origin = process.env.APP_ORIGIN;
const controlSecret = process.env.COLLABORATION_CONTROL_SECRET;
if (!databaseUrl || !redisUrl || !origin || !controlSecret || controlSecret.length < 32)
  throw new Error(
    'Set DATABASE_URL, REDIS_URL, APP_ORIGIN, and a 32-character COLLABORATION_CONTROL_SECRET',
  );
const port = Number(process.env.COLLABORATION_PORT ?? 1234);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Invalid collaboration port');
const lock = new pg.Client({
  connectionString: databaseUrl,
  keepAlive: true,
  connectionTimeoutMillis: 5000,
});
const database = createRoomStore(databaseUrl);
const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
  connectTimeout: 5000,
  lazyConnect: true,
});
redis.on('error', () =>
  console.error(JSON.stringify({ service: 'collaboration', event: 'redis_unavailable' })),
);
const tickets = connectionTickets(redis);
const relay = createRelay({
  origin: new URL(origin).origin,
  controlSecret,
  repository: documentRepository(database.store),
  authorize: (token, roomId) => tickets.consume(token, roomId),
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 15000);
  deadline.unref();
  try {
    await relay.close();
  } catch {
    console.error(JSON.stringify({ service: 'collaboration', event: 'shutdown_failed' }));
    process.exitCode = 1;
  } finally {
    redis.disconnect();
    await Promise.allSettled([database.close(), lock.end()]);
    clearTimeout(deadline);
  }
}
lock.on('error', () => {
  process.exitCode = 1;
  void close();
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void close();
  });
try {
  await lock.connect();
  // Fail rather than silently creating two independent owners of the same documents.
  const owner = await lock.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock(727244021) AS acquired',
  );
  if (!owner.rows[0]?.acquired)
    throw new Error('A collaboration server already owns this database');
  await redis.connect();
  if (!closing) {
    await new Promise<void>((resolve, reject) => {
      relay.server.once('error', reject);
      relay.server.listen(port, process.env.COLLABORATION_HOST ?? '127.0.0.1', resolve);
    });
    console.log(JSON.stringify({ service: 'collaboration', event: 'listening', port }));
  }
} catch {
  console.error(JSON.stringify({ service: 'collaboration', event: 'startup_failed' }));
  process.exitCode = 1;
  await close();
}
