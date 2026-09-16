import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';

export interface Sql {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface RoomStore extends Sql {
  transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T>;
}
export class RoomError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export interface RoomSummary {
  id: string;
  title: string;
  status: 'ACTIVE' | 'ENDED';
  createdAt: Date;
  endedAt: Date | null;
  ownerId: string;
  selectedProblemId: string;
}
type LockedRoom = RoomSummary & { inviteExpiresAt: Date | null };
type Member = { userId: string; seat: number; role: 'OWNER' | 'PARTICIPANT'; displayName: string };
const summaryColumns =
  'r.id, r.title, r.status, r."createdAt", r."endedAt", r."ownerId", r."selectedProblemId"';
export const inviteHash = (token: string) => createHash('sha256').update(token).digest('hex');
const newInvite = () => {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: inviteHash(token), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
};

/** All mutations lock the room first: joining, ending, and rotation share one ordering. */
export function createRoomService(store: RoomStore) {
  async function requireMember(sql: Sql, roomId: string, userId: string) {
    const result = await sql.query<{ role: Member['role'] }>(
      'SELECT role FROM "RoomMember" WHERE "roomId"=$1 AND "userId"=$2',
      [roomId, userId],
    );
    if (!result.rows[0])
      throw new RoomError(404, 'ROOM_NOT_FOUND', 'This room is not available to your account.');
    return result.rows[0];
  }
  async function lockRoom(sql: Sql, roomId: string, userId: string, ownerOnly = false) {
    const result = await sql.query<LockedRoom>(
      `SELECT ${summaryColumns}, r."inviteExpiresAt" FROM "Room" r WHERE r.id=$1 FOR UPDATE`,
      [roomId],
    );
    if (!result.rows[0])
      throw new RoomError(404, 'ROOM_NOT_FOUND', 'This room is not available to your account.');
    const member = await requireMember(sql, roomId, userId);
    if (ownerOnly && member.role !== 'OWNER')
      throw new RoomError(403, 'OWNER_REQUIRED', 'Only the room owner can do that.');
    return result.rows[0];
  }
  async function event(sql: Sql, roomId: string, userId: string, type: string) {
    await sql.query(
      'INSERT INTO "RoomEvent" (id,"roomId","actorId","eventType") VALUES ($1,$2,$3,$4::"RoomEventType")',
      [randomUUID(), roomId, userId, type],
    );
  }
  return {
    async syncUser(clerkId: string, displayName: string) {
      const result = await store.query<{ id: string }>(
        'INSERT INTO "User" (id,"clerkId","displayName","updatedAt") VALUES ($1,$2,$3,now()) ON CONFLICT ("clerkId") DO UPDATE SET "displayName"=EXCLUDED."displayName", "updatedAt"=now() RETURNING id',
        [randomUUID(), clerkId, displayName.trim().slice(0, 100) || 'Student'],
      );
      return result.rows[0]!.id;
    },
    async problems() {
      return (
        await store.query<{ id: string; title: string; slug: string }>(
          'SELECT DISTINCT ON (slug) id,title,slug FROM "Problem" ORDER BY slug,version DESC',
        )
      ).rows;
    },
    async list(userId: string, before?: string) {
      // UUIDs make equal-timestamp pagination stable without exposing another user's rooms.
      const rows = (
        await store.query<RoomSummary>(
          `SELECT ${summaryColumns} FROM "Room" r JOIN "RoomMember" m ON m."roomId"=r.id WHERE m."userId"=$1 AND ($2::uuid IS NULL OR (r."createdAt",r.id) < (SELECT "createdAt",id FROM "Room" WHERE id=$2)) ORDER BY r."createdAt" DESC,r.id DESC LIMIT 21`,
          [userId, before ?? null],
        )
      ).rows;
      return { rooms: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19]!.id : null };
    },
    async create(userId: string, input: { title: string; problemId: string }) {
      const invite = newInvite();
      const roomId = randomUUID();
      await store.transaction(async (sql) => {
        // Serialize creation for this user, so the active-room cap also holds under concurrency.
        await sql.query('SELECT id FROM "User" WHERE id=$1 FOR UPDATE', [userId]);
        const count = await sql.query<{ count: string }>(
          'SELECT count(*) FROM "Room" WHERE "ownerId"=$1 AND status=\'ACTIVE\'',
          [userId],
        );
        if (Number(count.rows[0]!.count) >= 20)
          throw new RoomError(409, 'ROOM_LIMIT', 'End an existing room before creating another.');
        const problem = await sql.query('SELECT id FROM "Problem" WHERE id=$1', [input.problemId]);
        if (!problem.rows.length)
          throw new RoomError(422, 'INVALID_PROBLEM', 'Choose an available problem.');
        await sql.query(
          'INSERT INTO "Room" (id,"ownerId",title,"selectedProblemId","inviteTokenHash","inviteExpiresAt") VALUES ($1,$2,$3,$4,$5,$6)',
          [roomId, userId, input.title, input.problemId, invite.hash, invite.expiresAt],
        );
        await sql.query(
          'INSERT INTO "RoomMember" ("roomId","userId",seat,role) VALUES ($1,$2,1,\'OWNER\')',
          [roomId, userId],
        );
        await event(sql, roomId, userId, 'CREATED');
      });
      return { roomId, inviteToken: invite.token, expiresAt: invite.expiresAt };
    },
    async join(userId: string, token: string) {
      return store.transaction(async (sql) => {
        const result = await sql.query<LockedRoom>(
          `SELECT ${summaryColumns},r."inviteExpiresAt" FROM "Room" r WHERE r."inviteTokenHash"=$1 FOR UPDATE`,
          [inviteHash(token)],
        );
        const room = result.rows[0];
        if (
          !room ||
          room.status !== 'ACTIVE' ||
          !room.inviteExpiresAt ||
          new Date(room.inviteExpiresAt).getTime() <= Date.now()
        )
          throw new RoomError(
            404,
            'INVALID_INVITE',
            'This invitation is invalid or expired. Ask the owner for a new link.',
          );
        const existing = await sql.query(
          'SELECT seat FROM "RoomMember" WHERE "roomId"=$1 AND "userId"=$2',
          [room.id, userId],
        );
        if (existing.rows.length) return { roomId: room.id };
        const count = await sql.query<{ count: string }>(
          'SELECT count(*) FROM "RoomMember" WHERE "roomId"=$1',
          [room.id],
        );
        if (Number(count.rows[0]!.count) >= 2)
          throw new RoomError(
            409,
            'ROOM_FULL',
            'Both seats are taken. Ask your partner to create a new room.',
          );
        await sql.query(
          'INSERT INTO "RoomMember" ("roomId","userId",seat,role) VALUES ($1,$2,2,\'PARTICIPANT\')',
          [room.id, userId],
        );
        await event(sql, room.id, userId, 'JOINED');
        return { roomId: room.id };
      });
    },
    async detail(userId: string, roomId: string) {
      await requireMember(store, roomId, userId);
      const room = (
        await store.query<RoomSummary>(`SELECT ${summaryColumns} FROM "Room" r WHERE r.id=$1`, [
          roomId,
        ])
      ).rows[0];
      if (!room) throw new RoomError(404, 'ROOM_NOT_FOUND', 'This room is not available.');
      const members = (
        await store.query<Member>(
          'SELECT m."userId",m.seat,m.role,u."displayName" FROM "RoomMember" m JOIN "User" u ON u.id=m."userId" WHERE m."roomId"=$1 ORDER BY m.seat',
          [roomId],
        )
      ).rows;
      const problem = (
        await store.query<{
          id: string;
          title: string;
          promptMarkdown: string;
          starterCode: string;
          constraints: string;
        }>(
          'SELECT id,title,"promptMarkdown","starterCode",constraints FROM "Problem" WHERE id=$1',
          [room.selectedProblemId],
        )
      ).rows[0];
      const snapshot =
        room.status === 'ENDED'
          ? (
              await store.query<{ sourceCode: string }>(
                'SELECT "sourceCode" FROM "CodeSnapshot" WHERE "roomId"=$1 AND "problemId"=$2 ORDER BY "createdAt" DESC,id DESC LIMIT 1',
                [roomId, room.selectedProblemId],
              )
            ).rows[0]
          : undefined;
      return {
        room,
        members,
        problem,
        savedCode: snapshot?.sourceCode ?? null,
        isOwner: room.ownerId === userId,
      };
    },
    async rotateInvite(userId: string, roomId: string) {
      const invite = newInvite();
      await store.transaction(async (sql) => {
        const room = await lockRoom(sql, roomId, userId, true);
        if (room.status !== 'ACTIVE')
          throw new RoomError(
            409,
            'ROOM_ENDED',
            'This room has ended. Create another to practice again.',
          );
        await sql.query('UPDATE "Room" SET "inviteTokenHash"=$2,"inviteExpiresAt"=$3 WHERE id=$1', [
          roomId,
          invite.hash,
          invite.expiresAt,
        ]);
      });
      return { roomId, inviteToken: invite.token, expiresAt: invite.expiresAt };
    },
    async end(userId: string, roomId: string) {
      await store.transaction(async (sql) => {
        const room = await lockRoom(sql, roomId, userId, true);
        if (room.status === 'ENDED') return;
        await sql.query(
          'UPDATE "Room" SET status=\'ENDED\',"endedAt"=now(),"inviteTokenHash"=NULL,"inviteExpiresAt"=NULL WHERE id=$1',
          [roomId],
        );
        await event(sql, roomId, userId, 'ENDED');
      });
      return { roomId, status: 'ENDED' as const };
    },
  };
}
export type RoomService = ReturnType<typeof createRoomService>;
