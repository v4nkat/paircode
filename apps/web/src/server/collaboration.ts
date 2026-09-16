import { Redis } from 'ioredis';
import { connectionTickets } from '@paircode/queue/tickets';
import { RoomError } from '@paircode/database/rooms';
import type { RoomService } from '@paircode/database/rooms';

let cache: Redis | undefined;
export function collaborationActions(service: () => RoomService) {
  return {
    async collaborationTicket(userId: string, roomId: string, clientId: number) {
      const detail = await service().detail(userId, roomId);
      if (detail.room.status !== 'ACTIVE')
        throw new RoomError(409, 'ROOM_ENDED', 'This room has ended.');
      const url = process.env.NEXT_PUBLIC_COLLABORATION_URL;
      if (
        !url ||
        !process.env.REDIS_URL ||
        !process.env.COLLABORATION_CONTROL_SECRET ||
        !process.env.COLLABORATION_INTERNAL_URL
      )
        throw new RoomError(503, 'NOT_CONFIGURED', 'Shared editing is not configured yet.');
      const parsed = new URL(url);
      if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password)
        throw new Error('Invalid collaboration URL');
      if (!cache) {
        cache = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 5000 });
        cache.on('error', () => {}); // The request boundary logs a sanitized failure.
      }
      const member = detail.members.find((m) => m.userId === userId)!;
      const identity = {
        roomId,
        userId,
        clientId,
        displayName: member.displayName,
        color: member.seat === 1 ? ('#26724b' as const) : ('#865cb5' as const),
      };
      const ticket = await connectionTickets(cache).issue(identity);
      return { ticket, url: parsed.toString().replace(/\/$/, ''), identity };
    },
    async endRoom(userId: string, roomId: string) {
      const detail = await service().detail(userId, roomId);
      if (!detail.isOwner)
        throw new RoomError(403, 'OWNER_REQUIRED', 'Only the owner can end this room.');
      if (detail.room.status === 'ENDED') return { roomId, status: 'ENDED' };
      // Once editing is enabled, a relay failure must not bypass the final document flush.
      if (!process.env.NEXT_PUBLIC_COLLABORATION_URL) return service().end(userId, roomId);
      const internal = process.env.COLLABORATION_INTERNAL_URL;
      const secret = process.env.COLLABORATION_CONTROL_SECRET;
      if (!internal || !secret)
        throw new RoomError(503, 'NOT_CONFIGURED', 'The editor cannot save this session yet.');
      const response = await fetch(new URL(`/internal/rooms/${roomId}/end`, internal), {
        method: 'POST',
        cache: 'no-store',
        redirect: 'error',
        headers: { Authorization: `Bearer ${secret}`, 'X-Paircode-User': userId },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new RoomError(
          503,
          'SAVE_FAILED',
          'The final save did not complete. Keep the editor open and try again.',
        );
      return { roomId, status: 'ENDED' };
    },
  };
}
