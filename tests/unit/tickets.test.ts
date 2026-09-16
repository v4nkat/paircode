import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { connectionTickets } from '../../packages/queue/src/tickets.js';

function fixture() {
  let now = 0;
  const values = new Map<string, { value: string; expires: number }>();
  const tickets = connectionTickets({
    async set(key, value, _ex, ttl) {
      if (values.has(key)) return null;
      values.set(key, { value, expires: now + ttl });
      return 'OK';
    },
    async getdel(key) {
      const entry = values.get(key);
      values.delete(key);
      return entry && now < entry.expires ? entry.value : null;
    },
  });
  const identity = {
    roomId: randomUUID(),
    userId: randomUUID(),
    clientId: 42,
    displayName: 'Partner',
    color: '#26724b' as const,
  };
  return {
    tickets,
    identity,
    values,
    advance: (seconds: number) => {
      now += seconds;
    },
  };
}
describe('single-use collaboration tickets', () => {
  it('stores only a token hash and atomically consumes identity once', async () => {
    const f = fixture();
    const token = await f.tickets.issue(f.identity);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify([...f.values])).not.toContain(token);
    const results = await Promise.all([
      f.tickets.consume(token, f.identity.roomId),
      f.tickets.consume(token, f.identity.roomId),
    ]);
    expect(results).toEqual([f.identity, null]);
  });
  it('expires at 30 seconds and burns a ticket used against the wrong room', async () => {
    const f = fixture();
    const first = await f.tickets.issue(f.identity);
    f.advance(30);
    expect(await f.tickets.consume(first, f.identity.roomId)).toBeNull();
    const second = await f.tickets.issue(f.identity);
    expect(await f.tickets.consume(second, randomUUID())).toBeNull();
    expect(await f.tickets.consume(second, f.identity.roomId)).toBeNull();
  });
  it('rejects malformed tokens and identities', async () => {
    const f = fixture();
    expect(await f.tickets.consume('not-a-ticket', f.identity.roomId)).toBeNull();
    await expect(f.tickets.issue({ ...f.identity, clientId: -1 })).rejects.toThrow();
  });
});
