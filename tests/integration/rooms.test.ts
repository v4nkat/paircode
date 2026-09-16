import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRoomService, inviteHash } from '../../packages/database/src/rooms.js';
import type { RoomStore, Sql } from '../../packages/database/src/rooms.js';
import { createRoomApi } from '../../apps/web/src/server/room-api.js';
import { documentRepository } from '../../apps/collaboration/src/repository.js';
import * as Y from 'yjs';

let memory: PGlite | undefined;
let pool: pg.Pool | undefined;
let control: pg.Client | undefined;
let store: RoomStore;
let service: ReturnType<typeof createRoomService>;
const namespace = `rooms_${randomUUID().replaceAll('-', '')}`;
const problemId = randomUUID();
beforeAll(async () => {
  const migration = await readFile(
    'packages/database/prisma/migrations/20260914000000_foundation/migration.sql',
    'utf8',
  );
  if (process.env.TEST_DATABASE_URL) {
    control = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await control.connect();
    await control.query(`CREATE SCHEMA "${namespace}"`);
    await control.query(`SET search_path TO "${namespace}"`);
    await control.query(
      migration
        .replaceAll('"public".', `"${namespace}".`)
        .replaceAll('CREATE SCHEMA IF NOT EXISTS "public";', ''),
    );
    pool = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${namespace}`,
      max: 5,
    });
    const activePool = pool;
    store = {
      query: (text, values) => activePool.query(text, values),
      async transaction(work) {
        const client = await activePool.connect();
        try {
          await client.query('BEGIN');
          const value = await work(client);
          await client.query('COMMIT');
          return value;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
    };
  } else {
    memory = new PGlite();
    await memory.exec(migration);
    const db = memory;
    store = {
      query: (text, values) => db.query(text, values),
      transaction: (work) => db.transaction((tx) => work(tx as Sql)),
    };
  }
  service = createRoomService(store);
  await store.query(
    "INSERT INTO \"Problem\" (id,slug,version,title,\"promptMarkdown\",language,\"starterCode\",\"functionSignature\",constraints,comparator) VALUES ($1,'room-test',1,'Practice','A problem','python','pass','solve()','Small inputs','JSON_EXACT')",
    [problemId],
  );
  await store.query(
    'INSERT INTO "TestCase" (id,"problemId",visibility,input,"expectedOutput",ordering) VALUES ($1,$2,\'HIDDEN\',$3,$4,1)',
    [
      randomUUID(),
      problemId,
      JSON.stringify('private-input-canary'),
      JSON.stringify('private-answer-canary'),
    ],
  );
});
afterAll(async () => {
  await pool?.end();
  if (control) {
    await control.query(`DROP SCHEMA "${namespace}" CASCADE`);
    await control.end();
  }
  await memory?.close();
});
async function fixture() {
  const owner = await service.syncUser(randomUUID(), 'Owner');
  const guest = await service.syncUser(randomUUID(), 'Guest');
  const outsider = await service.syncUser(randomUUID(), 'Outsider');
  const invitation = await service.create(owner, { title: 'Practice together', problemId });
  return { owner, guest, outsider, ...invitation };
}

describe('room membership and invitations', () => {
  it('stores a token hash and returns no hidden test data or invite credentials in room details', async () => {
    const f = await fixture();
    const stored = await store.query<{ inviteTokenHash: string }>(
      'SELECT "inviteTokenHash" FROM "Room" WHERE id=$1',
      [f.roomId],
    );
    expect(stored.rows[0]!.inviteTokenHash).toBe(inviteHash(f.inviteToken));
    const detail = await service.detail(f.owner, f.roomId);
    expect(detail.members).toHaveLength(1);
    expect(detail.isOwner).toBe(true);
    const json = JSON.stringify(detail);
    for (const forbidden of [
      f.inviteToken,
      inviteHash(f.inviteToken),
      'private-input-canary',
      'private-answer-canary',
      'clerkId',
    ])
      expect(json).not.toContain(forbidden);
  });
  it('makes duplicate joins idempotent and rejects a third member', async () => {
    const f = await fixture();
    await service.join(f.guest, f.inviteToken);
    await service.join(f.guest, f.inviteToken);
    await expect(service.join(f.outsider, f.inviteToken)).rejects.toMatchObject({
      code: 'ROOM_FULL',
    });
    expect((await service.detail(f.guest, f.roomId)).members).toHaveLength(2);
    const events = await store.query(
      'SELECT id FROM "RoomEvent" WHERE "roomId"=$1 AND "eventType"=\'JOINED\'',
      [f.roomId],
    );
    expect(events.rows).toHaveLength(1);
  });
  it('keeps room lists scoped to membership and denies non-member reads and owner actions', async () => {
    const f = await fixture();
    await service.join(f.guest, f.inviteToken);
    expect((await service.list(f.outsider)).rooms).toHaveLength(0);
    await expect(service.detail(f.outsider, f.roomId)).rejects.toMatchObject({ status: 404 });
    await expect(service.rotateInvite(f.outsider, f.roomId)).rejects.toMatchObject({ status: 404 });
    await expect(service.end(f.guest, f.roomId)).rejects.toMatchObject({ status: 403 });
    await expect(service.rotateInvite(f.guest, f.roomId)).rejects.toMatchObject({ status: 403 });
  });
  it('rejects invalid, expired and rotated invitations', async () => {
    const f = await fixture();
    await expect(service.join(f.guest, 'x'.repeat(43))).rejects.toMatchObject({
      code: 'INVALID_INVITE',
    });
    await store.query(
      'UPDATE "Room" SET "inviteExpiresAt"=now()-interval \'1 second\' WHERE id=$1',
      [f.roomId],
    );
    await expect(service.join(f.guest, f.inviteToken)).rejects.toMatchObject({
      code: 'INVALID_INVITE',
    });
    const rotated = await service.rotateInvite(f.owner, f.roomId);
    await expect(service.join(f.guest, f.inviteToken)).rejects.toMatchObject({
      code: 'INVALID_INVITE',
    });
    await expect(service.join(f.guest, rotated.inviteToken)).resolves.toEqual({ roomId: f.roomId });
  });
  it('ends once, revokes invitations, and preserves member access', async () => {
    const f = await fixture();
    await service.join(f.guest, f.inviteToken);
    await service.end(f.owner, f.roomId);
    await service.end(f.owner, f.roomId);
    await expect(service.join(f.outsider, f.inviteToken)).rejects.toMatchObject({
      code: 'INVALID_INVITE',
    });
    await expect(service.rotateInvite(f.owner, f.roomId)).rejects.toMatchObject({
      code: 'ROOM_ENDED',
    });
    expect((await service.detail(f.guest, f.roomId)).room.status).toBe('ENDED');
    expect(
      (
        await store.query(
          'SELECT id FROM "RoomEvent" WHERE "roomId"=$1 AND "eventType"=\'ENDED\'',
          [f.roomId],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it.runIf(Boolean(process.env.TEST_DATABASE_URL))(
    'serializes competing joins on separate PostgreSQL connections',
    async () => {
      const f = await fixture();
      const results = await Promise.allSettled([
        service.join(f.guest, f.inviteToken),
        service.join(f.outsider, f.inviteToken),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected?.status === 'rejected' ? rejected.reason.code : null).toBe('ROOM_FULL');
      expect((await service.detail(f.owner, f.roomId)).members).toHaveLength(2);
    },
  );
});

describe('room HTTP boundary', () => {
  const origin = 'https://paircode.example';
  function api(user: string | null) {
    return createRoomApi({
      service: () => service,
      authenticate: async () => user,
      origin: () => origin,
    });
  }
  function post(payload: unknown, requestOrigin = origin) {
    return new Request(origin + '/api/rooms', {
      method: 'POST',
      headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
  it('rejects unauthenticated access and cross-origin mutations', async () => {
    expect((await api(null)(new Request(origin + '/api/rooms'), [])).status).toBe(401);
    const f = await fixture();
    expect(
      (await api(f.owner)(post({ title: 'bad', problemId }, 'https://attacker.example'), []))
        .status,
    ).toBe(403);
  });
  it('validates bodies and caps chunked payloads without trusting Content-Length', async () => {
    const f = await fixture();
    expect((await api(f.owner)(post({ title: '', problemId }), [])).status).toBe(422);
    expect((await api(f.owner)(post({ title: 'x'.repeat(17000), problemId }), [])).status).toBe(
      413,
    );
    expect(
      (await api(f.owner)(post({ title: 'valid', problemId, ownerId: f.outsider }), [])).status,
    ).toBe(422);
  });
  it('creates and joins through the route handler with private caching and safe errors', async () => {
    const f = await fixture();
    const created = await api(f.owner)(post({ title: 'Route test', problemId }), []);
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toContain('no-store');
    const data = (await created.json()) as { roomId: string; inviteToken: string };
    const joined = await api(f.guest)(post({ inviteToken: data.inviteToken }), ['join']);
    expect(joined.status).toBe(200);
    const forbidden = await api(f.outsider)(new Request(origin + '/api/rooms/' + data.roomId), [
      data.roomId,
    ]);
    expect(forbidden.status).toBe(404);
    expect(await forbidden.json()).toMatchObject({
      error: { code: 'ROOM_NOT_FOUND', requestId: expect.any(String) },
    });
  });
});

describe('collaboration persistence', () => {
  it('restores Yjs state and atomically saves the final snapshot while revoking editing access', async () => {
    const f = await fixture();
    await service.join(f.guest, f.inviteToken);
    const repository = documentRepository(store);
    expect(await repository.canAccess(f.roomId, f.owner)).toBe(true);
    expect(await repository.canAccess(f.roomId, f.outsider)).toBe(false);
    const initial = await repository.load(f.roomId);
    expect(initial.state).toBeNull();
    const doc = new Y.Doc();
    doc.getText(problemId).insert(0, '# persisted\npass');
    const state = Y.encodeStateAsUpdate(doc);
    const sources = { [problemId]: doc.getText(problemId).toString() };
    await repository.save(f.roomId, state, sources);
    await repository.save(f.roomId, state, sources);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, (await repository.load(f.roomId)).state!);
    expect(restored.getText(problemId).toString()).toBe(sources[problemId]);
    expect(
      (await store.query('SELECT id FROM "CodeSnapshot" WHERE "roomId"=$1', [f.roomId])).rows,
    ).toHaveLength(1);
    await expect(repository.save(f.roomId, state, sources, f.guest)).rejects.toThrow(
      'Owner required',
    );
    expect((await service.detail(f.owner, f.roomId)).room.status).toBe('ACTIVE');
    await repository.save(f.roomId, state, sources, f.owner);
    await repository.save(f.roomId, state, sources, f.owner);
    expect(await repository.canAccess(f.roomId, f.owner)).toBe(false);
    expect((await service.detail(f.guest, f.roomId)).room.status).toBe('ENDED');
    const final = await store.query<{ sourceCode: string }>(
      'SELECT "sourceCode" FROM "CodeSnapshot" WHERE "roomId"=$1 AND reason=\'SESSION_END\'',
      [f.roomId],
    );
    expect(final.rows).toEqual([{ sourceCode: sources[problemId] }]);
    await expect(repository.save(f.roomId, state, sources)).rejects.toThrow('Room unavailable');
    await expect(service.join(f.outsider, f.inviteToken)).rejects.toMatchObject({
      code: 'INVALID_INVITE',
    });
    doc.destroy();
    restored.destroy();
  });
  it('rolls back document state when the selected draft is absent', async () => {
    const f = await fixture();
    const repository = documentRepository(store);
    await expect(repository.save(f.roomId, new Uint8Array([0, 0]), {})).rejects.toThrow(
      'Missing selected draft',
    );
    expect((await repository.load(f.roomId)).state).toBeNull();
  });
});
