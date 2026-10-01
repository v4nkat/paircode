import { describe, expect, it } from 'vitest';
import { checkReadiness } from '../../apps/web/src/server/readiness.js';

describe('readiness', () => {
  it('reports ready only when configured dependencies answer', async () => {
    const result = await checkReadiness(
      { database: true, redis: true, identity: true },
      { database: async () => {}, redis: async () => {} },
    );
    expect(result).toEqual({
      status: 'ready',
      checks: { database: 'ok', redis: 'ok', identity: 'ok' },
    });
  });

  it('fails closed without exposing dependency errors', async () => {
    const result = await checkReadiness(
      { database: true, redis: true, identity: false },
      {
        database: async () => {},
        redis: async () => {
          throw new Error('redis://secret-password@host');
        },
      },
    );
    expect(result).toEqual({
      status: 'unavailable',
      checks: { database: 'ok', redis: 'unavailable', identity: 'not_configured' },
    });
    expect(JSON.stringify(result)).not.toContain('secret-password');
  });
});
