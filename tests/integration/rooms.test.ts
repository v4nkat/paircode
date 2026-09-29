import { randomUUID } from 'node:crypto';
import { migrationSql } from '../support/migrations.js';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRoomService, inviteHash } from '../../packages/database/src/rooms.js';
import type { RoomStore, Sql } from '../../packages/database/src/rooms.js';
import { createRoomApi } from '../../apps/web/src/server/room-api.js';
import { documentRepository } from '../../apps/collaboration/src/repository.js';
import * as Y from 'yjs';
import { executionService, executionRepository } from '../../packages/database/src/executions.js';
import { executionProcessor } from '../../apps/worker/src/process-execution.js';
import { SandboxError } from '../../apps/worker/src/sandbox.js';
import type { Sandbox, Outcome } from '../../apps/worker/src/sandbox.js';

let memory: PGlite | undefined;
let pool: pg.Pool | undefined;
let control: pg.Client | undefined;
let store: RoomStore;
let service: ReturnType<typeof createRoomService>;
const namespace = `rooms_${randomUUID().replaceAll('-', '')}`;
const problemId = randomUUID();
beforeAll(async () => {
  const migration = await migrationSql();
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
  it('saves an empty draft and can end the session after deleting all code', async () => {
    const f = await fixture();
    const repository = documentRepository(store);
    const doc = new Y.Doc();
    await repository.save(f.roomId, Y.encodeStateAsUpdate(doc), { [problemId]: '' }, f.owner);
    expect((await service.detail(f.owner, f.roomId)).savedCode).toBe('');
    doc.destroy();
  });
  it('pages member-only room events and saved drafts without revealing hidden cases', async () => {
    const f = await fixture();
    await service.join(f.guest, f.inviteToken);
    await documentRepository(store).save(f.roomId, new Uint8Array([0, 0]), {
      [problemId]: 'print(1)',
    });
    for (let index = 0; index < 22; index++)
      await store.query(
        'INSERT INTO "RoomEvent" (id,"roomId","actorId","eventType") VALUES ($1,$2,$3,\'PROBLEM_CHANGED\')',
        [randomUUID(), f.roomId, f.owner],
      );
    const first = await service.review(f.guest, f.roomId);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBeTruthy();
    const second = await service.review(f.guest, f.roomId, first.nextCursor!);
    expect(second.items.length).toBeGreaterThan(0);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(
      first.items.length + second.items.length,
    );
    expect([...first.items, ...second.items].some((item) => item.sourceCode === 'print(1)')).toBe(
      true,
    );
    expect(JSON.stringify([...first.items, ...second.items])).not.toContain('private-input-canary');
    await expect(service.review(f.outsider, f.roomId)).rejects.toMatchObject({ status: 404 });
  });
});

describe('durable Python execution pipeline', () => {
  const input = () => ({
    sourceCode: 'def solve(): return True',
    language: 'python' as const,
    problemId,
    selectionRevision: 0,
  });
  const outcome: Outcome = {
    finished: true,
    failure: null,
    value: 'private-answer-canary',
    output: 'private-input-canary',
    error: 'private-error-canary',
    durationMs: 7,
    memoryKb: 1024,
  };
  it('creates one immutable snapshot and event for repeated request keys, with authorized history', async () => {
    const f = await fixture(),
      runs = executionService(store),
      key = randomUUID();
    const run = await runs.submit(f.owner, f.roomId, input(), key);
    expect(await runs.submit(f.owner, f.roomId, input(), key)).toEqual(run);
    await expect(
      runs.submit(f.owner, f.roomId, { ...input(), sourceCode: 'changed' }, key),
    ).rejects.toMatchObject({ code: 'KEY_REUSED' });
    await expect(runs.submit(f.outsider, f.roomId, input(), randomUUID())).rejects.toMatchObject({
      code: 'ROOM_NOT_FOUND',
    });
    await expect(runs.list(f.outsider, f.roomId)).rejects.toMatchObject({ code: 'ROOM_NOT_FOUND' });
    await expect(runs.detail(f.outsider, f.roomId, run.id)).rejects.toMatchObject({
      code: 'ROOM_NOT_FOUND',
    });
    expect((await runs.list(f.owner, f.roomId)).executions).toHaveLength(1);
    expect(
      (
        await store.query(
          'SELECT id FROM "CodeSnapshot" WHERE "roomId"=$1 AND reason=\'EXECUTION\'',
          [f.roomId],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await store.query(
          'SELECT id FROM "RoomEvent" WHERE "roomId"=$1 AND "eventType"=\'EXECUTION_QUEUED\'',
          [f.roomId],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it('rejects stale problem revisions and rate-limits new requests while allowing an idempotent retry', async () => {
    const f = await fixture(),
      runs = executionService(store),
      key = randomUUID();
    await expect(
      runs.submit(f.owner, f.roomId, { ...input(), selectionRevision: 1 }, key),
    ).rejects.toMatchObject({ code: 'PROBLEM_CHANGED' });
    const first = await runs.submit(f.owner, f.roomId, input(), key);
    for (let i = 0; i < 5; i++) await runs.submit(f.owner, f.roomId, input(), randomUUID());
    await expect(runs.submit(f.owner, f.roomId, input(), randomUUID())).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect((await runs.submit(f.owner, f.roomId, input(), key)).id).toBe(first.id);
  });
  it('completes a queued run once and drops hidden output at both persistence and response boundaries', async () => {
    const f = await fixture(),
      runs = executionService(store),
      repository = executionRepository(store);
    const run = await runs.submit(f.owner, f.roomId, input(), randomUUID());
    let submissions = 0;
    const sandbox: Sandbox = {
      async submit() {
        submissions++;
        return randomUUID();
      },
      async poll() {
        return outcome;
      },
    };
    const process = executionProcessor(repository, sandbox);
    await process(run.id);
    await process(run.id);
    expect(submissions).toBe(1);
    const response = await runs.detail(f.owner, f.roomId, run.id);
    expect(response.execution.status).toBe('PASSED');
    expect(response.hiddenSummary).toEqual({ total: 1, passed: 1 });
    for (const secret of [
      'private-input-canary',
      'private-answer-canary',
      'private-error-canary',
      'sandboxToken',
    ])
      expect(JSON.stringify(response)).not.toContain(secret);
    expect(
      (
        await store.query(
          'SELECT "outputPreview","errorPreview" FROM "ExecutionTestResult" WHERE "executionId"=$1',
          [run.id],
        )
      ).rows,
    ).toEqual([{ outputPreview: null, errorPreview: null }]);
    expect(
      (
        await store.query('SELECT id FROM "RoomEvent" WHERE "deduplicationKey"=$1', [
          `execution-completed-${run.id}`,
        ])
      ).rows,
    ).toHaveLength(1);
  });
  it('keeps submitted code reviewable after a room ends', async () => {
    const f = await fixture(),
      runs = executionService(store);
    await service.join(f.guest, f.inviteToken);
    const submitted = input();
    const run = await runs.submit(f.owner, f.roomId, submitted, randomUUID());
    await service.end(f.owner, f.roomId);
    const review = await runs.detail(f.guest, f.roomId, run.id);
    expect(review.snapshot?.sourceCode).toBe(submitted.sourceCode);
    await expect(runs.submit(f.guest, f.roomId, submitted, randomUUID())).rejects.toMatchObject({
      code: 'ROOM_ENDED',
    });
    expect(JSON.stringify(await service.detail(f.guest, f.roomId))).not.toContain(
      'private-input-canary',
    );
  });
  it('lets either member switch problems with a revision guard', async () => {
    const f = await fixture();
    await service.join(f.guest, f.inviteToken);
    const next = randomUUID();
    await store.query(
      "INSERT INTO \"Problem\" (id,slug,version,title,\"promptMarkdown\",language,\"starterCode\",\"functionSignature\",constraints,comparator) VALUES ($1,$2,1,'Next','Prompt','python','pass','solve()','Small','JSON_EXACT')",
      [next, `next-${next}`],
    );
    await service.selectProblem(f.guest, f.roomId, next, 0);
    const detail = await service.detail(f.owner, f.roomId);
    expect(detail.problem?.id).toBe(next);
    expect(detail.room.selectionRevision).toBe(1);
    await expect(service.selectProblem(f.owner, f.roomId, problemId, 0)).rejects.toMatchObject({
      code: 'PROBLEM_CHANGED',
    });
    const stranger = await service.syncUser(randomUUID(), 'Stranger');
    await expect(service.selectProblem(stranger, f.roomId, problemId, 1)).rejects.toMatchObject({
      status: 404,
    });
    await service.end(f.owner, f.roomId);
    await expect(service.selectProblem(f.guest, f.roomId, problemId, 1)).rejects.toMatchObject({
      code: 'ROOM_ENDED',
    });
  });
  it('reuses a persisted sandbox token after a transient polling failure', async () => {
    const f = await fixture(),
      runs = executionService(store),
      repository = executionRepository(store);
    const run = await runs.submit(f.owner, f.roomId, input(), randomUUID());
    let submitted = 0,
      polls = 0;
    const sandbox: Sandbox = {
      async submit() {
        submitted++;
        return randomUUID();
      },
      async poll() {
        if (++polls === 1) throw new SandboxError(true);
        return outcome;
      },
    };
    const process = executionProcessor(repository, sandbox);
    await expect(process(run.id)).rejects.toThrow('temporarily unavailable');
    expect((await runs.detail(f.owner, f.roomId, run.id)).execution.status).toBe('RUNNING');
    await process(run.id);
    expect(submitted).toBe(1);
    expect((await runs.detail(f.owner, f.roomId, run.id)).execution.status).toBe('PASSED');
  });
  it('does not retry deterministic failures, and stale workers cannot finish another lease', async () => {
    const f = await fixture(),
      runs = executionService(store),
      repository = executionRepository(store);
    const run = await runs.submit(f.owner, f.roomId, input(), randomUUID());
    const first = await repository.claim(run.id);
    expect(first).not.toBeNull();
    expect(await repository.claim(run.id)).toBeNull();
    await expect(repository.finish(run.id, first!.lease, [], null)).rejects.toThrow(
      'Incomplete or inconsistent execution results',
    );
    await store.query(
      'UPDATE "Execution" SET "leaseExpiresAt"=now()-interval \'1 second\' WHERE id=$1',
      [run.id],
    );
    const second = await repository.claim(run.id);
    await expect(repository.finish(run.id, first!.lease, [], null)).rejects.toThrow('Lease lost');
    await repository.failed(run.id, second!.lease, true, 'WORKER_FAILURE');
    const sandbox: Sandbox = {
      async submit() {
        return randomUUID();
      },
      async poll() {
        return { ...outcome, failure: 'TIMEOUT' };
      },
    };
    await executionProcessor(repository, sandbox)(run.id);
    expect((await runs.detail(f.owner, f.roomId, run.id)).execution).toMatchObject({
      status: 'FAILED',
      errorCategory: 'TIMEOUT',
    });
  });
  it('returns a recoverable queued ID when Redis dispatch fails and validates HTTP run inputs', async () => {
    const f = await fixture(),
      runs = executionService(store);
    const origin = 'https://paircode.example';
    const api = createRoomApi({
      service: () => service,
      authenticate: async () => f.owner,
      origin: () => origin,
      executions: () => runs,
      dispatchExecution: async () => {
        throw new Error('Redis unavailable');
      },
    });
    const request = (payload: unknown) =>
      new Request(origin + '/api/rooms', {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'Idempotency-Key': randomUUID(),
        },
        body: JSON.stringify(payload),
      });
    expect(
      (await api(request({ ...input(), language: 'javascript' }), [f.roomId, 'executions'])).status,
    ).toBe(422);
    const response = await api(request(input()), [f.roomId, 'executions']);
    expect(response.status).toBe(202);
    const run = (await response.json()) as { id: string; status: string };
    expect(run.status).toBe('QUEUED');
    expect((await executionRepository(store).pending()).some((row) => row.id === run.id)).toBe(
      true,
    );
  });
});
