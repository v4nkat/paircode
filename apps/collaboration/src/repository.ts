import { createHash, randomUUID } from 'node:crypto';
import type { RoomStore } from '@paircode/database/rooms';
import type { DocumentRepository } from './relay.js';

export function documentRepository(store: RoomStore): DocumentRepository {
  return {
    async load(roomId) {
      const room = (
        await store.query<{ selectedProblemId: string; status: string }>(
          'SELECT "selectedProblemId",status FROM "Room" WHERE id=$1',
          [roomId],
        )
      ).rows[0];
      if (!room || room.status !== 'ACTIVE') throw new Error('Room unavailable');
      const saved = (
        await store.query<{ state: Uint8Array }>(
          'SELECT state FROM "RoomDocument" WHERE "roomId"=$1',
          [roomId],
        )
      ).rows[0];
      const drafts = (
        await store.query<{ id: string; source: string }>(
          'SELECT id,"starterCode" AS source FROM "Problem" ORDER BY slug,version',
        )
      ).rows;
      return { state: saved?.state ?? null, drafts, selectedProblemId: room.selectedProblemId };
    },
    async canAccess(roomId, userId) {
      return (
        (
          await store.query(
            'SELECT r.id FROM "Room" r JOIN "RoomMember" m ON m."roomId"=r.id WHERE r.id=$1 AND m."userId"=$2 AND r.status=\'ACTIVE\'',
            [roomId, userId],
          )
        ).rows.length === 1
      );
    },
    async save(roomId, state, sources, endingUserId) {
      await store.transaction(async (sql) => {
        const room = (
          await sql.query<{ selectedProblemId: string; ownerId: string; status: string }>(
            'SELECT "selectedProblemId","ownerId",status FROM "Room" WHERE id=$1 FOR UPDATE',
            [roomId],
          )
        ).rows[0];
        if (!room || room.status !== 'ACTIVE') {
          if (endingUserId && room?.ownerId === endingUserId && room.status === 'ENDED') return;
          throw new Error('Room unavailable');
        }
        if (endingUserId && room.ownerId !== endingUserId) throw new Error('Owner required');
        await sql.query(
          'INSERT INTO "RoomDocument" ("roomId",state,revision) VALUES ($1,$2,1) ON CONFLICT ("roomId") DO UPDATE SET state=EXCLUDED.state, revision="RoomDocument".revision+1,"savedAt"=now()',
          [roomId, Buffer.from(state)],
        );
        const source = sources[room.selectedProblemId];
        if (source === undefined) throw new Error('Missing selected draft');
        const sourceHash = createHash('sha256').update(source).digest('hex');
        const previous = (
          await sql.query<{ sourceHash: string }>(
            'SELECT "sourceHash" FROM "CodeSnapshot" WHERE "roomId"=$1 AND "problemId"=$2 ORDER BY "createdAt" DESC,id DESC LIMIT 1',
            [roomId, room.selectedProblemId],
          )
        ).rows[0];
        if (endingUserId || previous?.sourceHash !== sourceHash)
          await sql.query(
            'INSERT INTO "CodeSnapshot" (id,"roomId","problemId",language,"sourceCode","sourceHash","createdById",reason) VALUES ($1,$2,$3,\'python\',$4,$5,$6,$7::"SnapshotReason")',
            [
              randomUUID(),
              roomId,
              room.selectedProblemId,
              source,
              sourceHash,
              endingUserId ?? null,
              endingUserId ? 'SESSION_END' : 'CHECKPOINT',
            ],
          );
        if (endingUserId) {
          await sql.query(
            'UPDATE "Room" SET status=\'ENDED\',"endedAt"=now(),"inviteTokenHash"=NULL,"inviteExpiresAt"=NULL WHERE id=$1',
            [roomId],
          );
          await sql.query(
            'INSERT INTO "RoomEvent" (id,"roomId","actorId","eventType") VALUES ($1,$2,$3,\'ENDED\')',
            [randomUUID(), roomId, endingUserId],
          );
        }
      });
    },
  };
}
