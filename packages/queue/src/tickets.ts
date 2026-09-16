import { createHash, randomBytes } from 'node:crypto';
import { collaborationIdentitySchema } from '@paircode/contracts';
import type { CollaborationIdentity } from '@paircode/contracts';

interface TicketCache {
  set(key: string, value: string, expiry: 'EX', ttl: number, condition: 'NX'): Promise<unknown>;
  getdel(key: string): Promise<string | null>;
}
const key = (token: string) =>
  `paircode:ws-ticket:${createHash('sha256').update(token).digest('hex')}`;
export function connectionTickets(cache: TicketCache) {
  return {
    async issue(identity: CollaborationIdentity) {
      const valid = collaborationIdentitySchema.parse(identity);
      const token = randomBytes(32).toString('base64url');
      const saved = await cache.set(key(token), JSON.stringify(valid), 'EX', 30, 'NX');
      if (!saved) throw new Error('Could not allocate a connection ticket');
      return token;
    },
    async consume(token: string, roomId: string) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const value = await cache.getdel(key(token));
      if (!value) return null;
      try {
        const identity = collaborationIdentitySchema.parse(JSON.parse(value));
        return identity.roomId === roomId ? identity : null;
      } catch {
        return null;
      }
    },
  };
}
