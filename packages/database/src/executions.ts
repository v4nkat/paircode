import { createHash, randomUUID } from 'node:crypto';
import { RoomError } from '@paircode/database/rooms';
import type { RoomStore, Sql } from './rooms.js';

export interface RunInput {
  sourceCode: string;
  language: 'python';
  problemId: string;
  selectionRevision: number;
}
export type Failure =
  | 'WRONG_ANSWER'
  | 'TIMEOUT'
  | 'COMPILE_ERROR'
  | 'RUNTIME_ERROR'
  | 'QUEUE_FAILURE'
  | 'SANDBOX_UNAVAILABLE'
  | 'WORKER_FAILURE'
  | 'INTERNAL_ERROR';
export interface CaseResult {
  testCaseId: string;
  passed: boolean;
  durationMs: number | null;
  memoryKb: number | null;
  outputPreview: string | null;
  errorPreview: string | null;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const columns =
  'e.id,e.status,e."errorCategory",e."queuedAt",e."startedAt",e."completedAt",e."durationMs",e."codeSnapshotId",e."problemId",e."requestedById"';
async function member(sql: Sql, roomId: string, userId: string) {
  if (
    !(
      await sql.query('SELECT 1 FROM "RoomMember" WHERE "roomId"=$1 AND "userId"=$2', [
        roomId,
        userId,
      ])
    ).rows.length
  )
    throw new RoomError(404, 'ROOM_NOT_FOUND', 'This room is not available to your account.');
}
async function terminal(
  sql: Sql,
  id: string,
  status: 'PASSED' | 'FAILED' | 'ERROR',
  failure: Failure | null,
) {
  const row = (
    await sql.query<{ roomId: string; requestedById: string }>(
      `UPDATE "Execution" SET status=$2::"ExecutionStatus","errorCategory"=$3::"ErrorCategory","completedAt"=now(),"durationMs"=LEAST(2147483647,GREATEST(0,EXTRACT(EPOCH FROM (now()-COALESCE("startedAt","queuedAt")))*1000))::integer,"leaseToken"=NULL,"leaseExpiresAt"=NULL WHERE id=$1 RETURNING "roomId","requestedById"`,
      [id, status, failure],
    )
  ).rows[0]!;
  await sql.query(
    'INSERT INTO "RoomEvent" (id,"roomId","actorId","eventType","metadataJson","deduplicationKey") VALUES ($1,$2,$3,\'EXECUTION_COMPLETED\',$4,$5) ON CONFLICT ("deduplicationKey") DO NOTHING',
    [
      randomUUID(),
      row.roomId,
      row.requestedById,
      JSON.stringify({ executionId: id, status, errorCategory: failure }),
      `execution-completed-${id}`,
    ],
  );
}
export function executionService(store: RoomStore) {
  return {
    async submit(userId: string, roomId: string, input: RunInput, key: string) {
      const requestHash = hash(
        JSON.stringify([
          input.sourceCode,
          input.language,
          input.problemId,
          input.selectionRevision,
        ]),
      );
      return store.transaction(async (sql) => {
        await sql.query('SELECT id FROM "User" WHERE id=$1 FOR UPDATE', [userId]);
        const room = (
          await sql.query<{ status: string; selectedProblemId: string; selectionRevision: number }>(
            'SELECT status,"selectedProblemId","selectionRevision" FROM "Room" WHERE id=$1 FOR UPDATE',
            [roomId],
          )
        ).rows[0];
        await member(sql, roomId, userId);
        const existing = (
          await sql.query<{ id: string; status: string; requestHash: string }>(
            'SELECT id,status,"requestHash" FROM "Execution" WHERE "roomId"=$1 AND "requestedById"=$2 AND "idempotencyKey"=$3',
            [roomId, userId, key],
          )
        ).rows[0];
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new RoomError(
              409,
              'KEY_REUSED',
              'This request key was already used for different code.',
            );
          return { id: existing.id, status: existing.status };
        }
        if (!room || room.status !== 'ACTIVE')
          throw new RoomError(409, 'ROOM_ENDED', 'This room has ended.');
        if (
          room.selectedProblemId !== input.problemId ||
          room.selectionRevision !== input.selectionRevision
        )
          throw new RoomError(
            409,
            'PROBLEM_CHANGED',
            'The selected problem changed. Refresh the room before running tests.',
          );
        const rate = (
          await sql.query<{ userCount: string; roomCount: string }>(
            'SELECT count(*) FILTER (WHERE "requestedById"=$1) AS "userCount",count(*) FILTER (WHERE "roomId"=$2) AS "roomCount" FROM "Execution" WHERE "queuedAt">now()-interval \'1 minute\' AND ("requestedById"=$1 OR "roomId"=$2)',
            [userId, roomId],
          )
        ).rows[0]!;
        if (Number(rate.userCount) >= 6 || Number(rate.roomCount) >= 10)
          throw new RoomError(429, 'RATE_LIMITED', 'Too many runs. Wait one minute and try again.');
        const tests = await sql.query('SELECT id FROM "TestCase" WHERE "problemId"=$1 LIMIT 21', [
          input.problemId,
        ]);
        if (!tests.rows.length || tests.rows.length > 20)
          throw new RoomError(
            503,
            'TESTS_UNAVAILABLE',
            'Tests are not available for this problem.',
          );
        const id = randomUUID(),
          snapshotId = randomUUID();
        await sql.query(
          'INSERT INTO "CodeSnapshot" (id,"roomId","problemId",language,"sourceCode","sourceHash","createdById",reason) VALUES ($1,$2,$3,\'python\',$4,$5,$6,\'EXECUTION\')',
          [snapshotId, roomId, input.problemId, input.sourceCode, hash(input.sourceCode), userId],
        );
        await sql.query(
          'INSERT INTO "Execution" (id,"roomId","requestedById","codeSnapshotId","problemId",language,"idempotencyKey","requestHash","queueJobId") VALUES ($1,$2,$3,$4,$5,\'python\',$6,$7,$8)',
          [id, roomId, userId, snapshotId, input.problemId, key, requestHash, id],
        );
        await sql.query(
          'INSERT INTO "RoomEvent" (id,"roomId","actorId","eventType","metadataJson","deduplicationKey") VALUES ($1,$2,$3,\'EXECUTION_QUEUED\',$4,$5)',
          [
            randomUUID(),
            roomId,
            userId,
            JSON.stringify({ executionId: id }),
            `execution-queued-${id}`,
          ],
        );
        return { id, status: 'QUEUED' };
      });
    },
    async list(userId: string, roomId: string, cursor?: string) {
      await member(store, roomId, userId);
      const rows = (
        await store.query<{ id: string }>(
          `SELECT ${columns} FROM "Execution" e WHERE e."roomId"=$1 AND ($2::uuid IS NULL OR (e."queuedAt",e.id)<(SELECT "queuedAt",id FROM "Execution" WHERE id=$2 AND "roomId"=$1)) ORDER BY e."queuedAt" DESC,e.id DESC LIMIT 21`,
          [roomId, cursor ?? null],
        )
      ).rows;
      return { executions: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19]!.id : null };
    },
    async detail(userId: string, roomId: string, id: string) {
      await member(store, roomId, userId);
      const execution = (
        await store.query(`SELECT ${columns} FROM "Execution" e WHERE e.id=$1 AND e."roomId"=$2`, [
          id,
          roomId,
        ])
      ).rows[0];
      if (!execution) throw new RoomError(404, 'NOT_FOUND', 'This run is not available.');
      const results = (
        await store.query<{
          testCaseId: string;
          visibility: string;
          passed: boolean | null;
          durationMs: number | null;
          outputPreview: string | null;
          errorPreview: string | null;
        }>(
          'SELECT r."testCaseId",t.visibility,r.passed,r."durationMs",r."outputPreview",r."errorPreview" FROM "ExecutionTestResult" r JOIN "TestCase" t ON t.id=r."testCaseId" WHERE r."executionId"=$1 ORDER BY t.ordering',
          [id],
        )
      ).rows;
      return {
        execution,
        snapshot: (
          await store.query<{ sourceCode: string; language: string; title: string }>(
            'SELECT s."sourceCode",s.language,p.title FROM "Execution" e JOIN "CodeSnapshot" s ON s.id=e."codeSnapshotId" JOIN "Problem" p ON p.id=e."problemId" WHERE e.id=$1 AND e."roomId"=$2',
            [id, roomId],
          )
        ).rows[0],
        visibleResults: results
          .filter((r) => r.visibility === 'VISIBLE')
          .map((r) => ({
            id: r.testCaseId,
            passed: r.passed,
            durationMs: r.durationMs,
            outputPreview: r.outputPreview,
            errorPreview: r.errorPreview,
          })),
        hiddenSummary: {
          total: results.filter((r) => r.visibility === 'HIDDEN').length,
          passed: results.filter((r) => r.visibility === 'HIDDEN' && r.passed === true).length,
        },
      };
    },
  };
}

export function executionRepository(store: RoomStore) {
  async function owns(sql: Sql, id: string, lease: string) {
    return (
      (
        await sql.query(
          'SELECT id FROM "Execution" WHERE id=$1 AND status=\'RUNNING\' AND "leaseToken"=$2 AND "leaseExpiresAt">now() FOR UPDATE',
          [id, lease],
        )
      ).rows.length > 0
    );
  }
  return {
    async pending() {
      return (
        await store.query<{ id: string }>(
          'SELECT id FROM "Execution" WHERE status=\'QUEUED\' OR (status=\'RUNNING\' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt"<now())) ORDER BY "queuedAt" LIMIT 100',
        )
      ).rows;
    },
    async dispatched(id: string) {
      await store.query('UPDATE "Execution" SET "dispatchState"=\'ENQUEUED\' WHERE id=$1', [id]);
    },
    async claim(id: string) {
      return store.transaction(async (sql) => {
        const current = (
          await sql.query<{
            status: string;
            attemptCount: number;
            live: boolean;
            expired: boolean;
          }>(
            'SELECT status,"attemptCount",("leaseExpiresAt">now()) AS live,("queuedAt"<now()-interval \'15 minutes\') AS expired FROM "Execution" WHERE id=$1 FOR UPDATE',
            [id],
          )
        ).rows[0];
        if (!current || !['QUEUED', 'RUNNING'].includes(current.status) || current.live)
          return null;
        if (current.attemptCount >= 3 || current.expired) {
          await terminal(
            sql,
            id,
            'ERROR',
            current.status === 'QUEUED' ? 'QUEUE_FAILURE' : 'WORKER_FAILURE',
          );
          return null;
        }
        const lease = randomUUID();
        await sql.query(
          'UPDATE "Execution" SET status=\'RUNNING\',"startedAt"=COALESCE("startedAt",now()),"attemptCount"="attemptCount"+1,"leaseToken"=$2,"leaseExpiresAt"=now()+interval \'90 seconds\' WHERE id=$1',
          [id, lease],
        );
        const run = (
          await sql.query<{
            roomId: string;
            requestedById: string;
            sourceCode: string;
            slug: string;
            comparator: string;
          }>(
            'SELECT e."roomId",e."requestedById",s."sourceCode",p.slug,p.comparator FROM "Execution" e JOIN "CodeSnapshot" s ON s.id=e."codeSnapshotId" JOIN "Problem" p ON p.id=e."problemId" WHERE e.id=$1',
            [id],
          )
        ).rows[0]!;
        const tests = (
          await sql.query<{
            id: string;
            visibility: 'VISIBLE' | 'HIDDEN';
            input: unknown;
            expectedOutput: unknown;
            sandboxToken: string | null;
            submissionState: string | null;
            passed: boolean | null;
          }>(
            'SELECT t.id,t.visibility,t.input,t."expectedOutput",r."sandboxToken",r."submissionState",r.passed FROM "Execution" e JOIN "TestCase" t ON t."problemId"=e."problemId" LEFT JOIN "ExecutionTestResult" r ON r."executionId"=e.id AND r."testCaseId"=t.id WHERE e.id=$1 ORDER BY t.ordering',
            [id],
          )
        ).rows;
        return { ...run, id, lease, attempt: current.attemptCount + 1, tests };
      });
    },
    async renew(id: string, lease: string) {
      return (
        (
          await store.query(
            'UPDATE "Execution" SET "leaseExpiresAt"=now()+interval \'90 seconds\' WHERE id=$1 AND "leaseToken"=$2 AND status=\'RUNNING\' AND "leaseExpiresAt">now() RETURNING id',
            [id, lease],
          )
        ).rows.length > 0
      );
    },
    async token(id: string, lease: string, testId: string, token: string) {
      await store.transaction(async (sql) => {
        if (!(await owns(sql, id, lease))) throw new Error('Lease lost');
        await sql.query(
          'INSERT INTO "ExecutionTestResult" (id,"executionId","testCaseId","problemId","sandboxToken","submissionState") SELECT $1,e.id,$3,e."problemId",$4,\'SUBMITTED\' FROM "Execution" e WHERE e.id=$2 ON CONFLICT ("executionId","testCaseId") DO UPDATE SET "sandboxToken"=EXCLUDED."sandboxToken","submissionState"=\'SUBMITTED\'',
          [randomUUID(), id, testId, token],
        );
      });
    },
    async finish(id: string, lease: string, results: CaseResult[], failure: Failure | null) {
      await store.transaction(async (sql) => {
        if (!(await owns(sql, id, lease))) throw new Error('Lease lost');
        const expected = await sql.query<{ id: string }>(
          'SELECT t.id FROM "TestCase" t JOIN "Execution" e ON e."problemId"=t."problemId" WHERE e.id=$1',
          [id],
        );
        const ids = new Set(results.map((result) => result.testCaseId));
        if (
          !expected.rows.length ||
          ids.size !== results.length ||
          ids.size !== expected.rows.length ||
          expected.rows.some((test) => !ids.has(test.id)) ||
          (failure === null) !== results.every((result) => result.passed)
        )
          throw new Error('Incomplete or inconsistent execution results');
        for (const result of results)
          await sql.query(
            'UPDATE "ExecutionTestResult" r SET passed=$3,"durationMs"=$4,"memoryKb"=$5,"outputPreview"=CASE WHEN t.visibility=\'VISIBLE\' THEN $6 ELSE NULL END,"errorPreview"=CASE WHEN t.visibility=\'VISIBLE\' THEN $7 ELSE NULL END,"submissionState"=\'COMPLETED\' FROM "TestCase" t WHERE r."executionId"=$1 AND r."testCaseId"=$2 AND t.id=r."testCaseId"',
            [
              id,
              result.testCaseId,
              result.passed,
              result.durationMs,
              result.memoryKb,
              result.outputPreview,
              result.errorPreview,
            ],
          );
        await terminal(sql, id, failure ? 'FAILED' : 'PASSED', failure);
      });
    },
    async failed(id: string, lease: string, retry: boolean, category: Failure) {
      await store.transaction(async (sql) => {
        if (!(await owns(sql, id, lease))) return;
        if (retry)
          await sql.query(
            'UPDATE "Execution" SET "leaseToken"=NULL,"leaseExpiresAt"=now() WHERE id=$1',
            [id],
          );
        else await terminal(sql, id, 'ERROR', category);
      });
    },
  };
}
export type ExecutionRepository = ReturnType<typeof executionRepository>;
