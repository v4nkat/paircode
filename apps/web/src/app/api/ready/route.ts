import pg from 'pg';
import { Redis } from 'ioredis';
import { checkReadiness } from '../../../server/readiness';

export const runtime = 'nodejs';

async function database(url: string) {
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 1500,
    statement_timeout: 1500,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function redis(url: string) {
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 1500,
    commandTimeout: 1500,
  });
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.ping();
  } finally {
    client.disconnect();
  }
}

async function collaboration(url: string) {
  const response = await fetch(new URL('/healthz', url), {
    signal: AbortSignal.timeout(1500),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Collaboration unavailable');
}

export async function GET() {
  const env = process.env;
  const result = await checkReadiness(
    {
      database: Boolean(env.DATABASE_URL),
      redis: Boolean(env.REDIS_URL),
      collaboration: Boolean(env.COLLABORATION_INTERNAL_URL),
      identity: Boolean(env.CLERK_SECRET_KEY && env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
    },
    {
      database: () => database(env.DATABASE_URL!),
      redis: () => redis(env.REDIS_URL!),
      collaboration: () => collaboration(env.COLLABORATION_INTERNAL_URL!),
    },
  );
  return Response.json(result, {
    status: result.status === 'ready' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
