import { expect, it } from 'vitest';
import { infrastructureEnvSchema, parseEnvironment, workerEnvSchema } from '@paircode/config';

const base = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  APP_ORIGIN: 'http://localhost:3000',
};
it('validates infrastructure without asking for future sandbox credentials', () =>
  expect(parseEnvironment(infrastructureEnvSchema, base)).toEqual(base));
it('does not include secret values in a validation error', () => {
  expect(() =>
    parseEnvironment(infrastructureEnvSchema, { ...base, DATABASE_URL: 'private-secret-marker' }),
  ).toThrow('DATABASE_URL');
  try {
    parseEnvironment(infrastructureEnvSchema, { ...base, DATABASE_URL: 'private-secret-marker' });
  } catch (error) {
    expect(String(error)).not.toContain('private-secret-marker');
  }
});
it('refuses worker startup without an explicitly configured sandbox', () =>
  expect(() => parseEnvironment(workerEnvSchema, base)).toThrow('SANDBOX_API_URL'));
it('rejects unsupported database URL schemes', () =>
  expect(
    infrastructureEnvSchema.safeParse({ ...base, DATABASE_URL: 'https://example.com' }).success,
  ).toBe(false));
