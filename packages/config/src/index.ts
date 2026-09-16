import { z } from 'zod';

const tcpUrl = (protocols: string[]) =>
  z.url().refine((value) => {
    try {
      return protocols.includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, 'Unsupported URL protocol');

export const infrastructureEnvSchema = z.object({
  DATABASE_URL: tcpUrl(['postgresql:', 'postgres:']),
  REDIS_URL: tcpUrl(['redis:', 'rediss:']),
  APP_ORIGIN: tcpUrl(['http:', 'https:']),
});

export const webEnvSchema = infrastructureEnvSchema.extend({
  CLERK_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_COLLABORATION_URL: tcpUrl(['ws:', 'wss:']),
  COLLABORATION_INTERNAL_URL: tcpUrl(['http:', 'https:']),
  COLLABORATION_CONTROL_SECRET: z.string().min(32),
});

export const workerEnvSchema = infrastructureEnvSchema.extend({
  SANDBOX_API_URL: tcpUrl(['http:', 'https:']),
  SANDBOX_AUTH_TOKEN: z.string().min(1),
  SANDBOX_PYTHON_LANGUAGE_ID: z.coerce.number().int().positive(),
  SANDBOX_CPU_SECONDS: z.coerce.number().positive().max(5).default(2),
  SANDBOX_WALL_SECONDS: z.coerce.number().positive().max(30).default(10),
  SANDBOX_MEMORY_KB: z.coerce.number().int().positive().max(262144).default(131072),
});

export const limits = Object.freeze({
  sourceBytes: 65536,
  historyPageSize: 20,
  historyMaxPageSize: 100,
  runsPerUserPerMinute: 6,
  runsPerRoomPerMinute: 10,
  snapshotDebounceMs: 1000,
  snapshotMaxWaitMs: 5000,
});

/** Never include rejected values in a configuration error: they can contain secrets. */
export function parseEnvironment<T>(schema: z.ZodType<T>, env: Record<string, unknown>): T {
  const result = schema.safeParse(env);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Missing or invalid environment fields: ${fields.join(', ')}`);
  }
  return result.data;
}
