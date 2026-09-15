import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

// CI runs against a real PostgreSQL service. Without a URL, use PostgreSQL WASM locally.
// The configured TEST_DATABASE_URL must name a disposable database.
let memory: PGlite | undefined;
let client: pg.Client | undefined;
const namespace = `test_${randomUUID().replaceAll('-', '')}`;
async function query(sql: string, params: unknown[] = []) {
  if (client) return client.query(sql, params);
  if (!memory) throw new Error('Database not initialized');
  return memory.query(sql, params);
}
beforeAll(async () => {
  const migration = await readFile(
    'packages/database/prisma/migrations/20260914000000_foundation/migration.sql',
    'utf8',
  );
  if (process.env.TEST_DATABASE_URL) {
    client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    await client.query(`CREATE SCHEMA "${namespace}"`);
    await client.query(`SET search_path TO "${namespace}"`);
    // Prisma emits public schema qualification; isolate only this known generated namespace.
    await client.query(
      migration
        .replaceAll('"public".', `"${namespace}".`)
        .replaceAll('CREATE SCHEMA IF NOT EXISTS "public";', ''),
    );
  } else {
    memory = new PGlite();
    await memory.exec(migration);
  }
});
afterAll(async () => {
  if (client) {
    await client.query(`DROP SCHEMA "${namespace}" CASCADE`);
    await client.end();
  }
  if (memory) await memory.close();
});

async function fixture() {
  const owner = randomUUID(),
    guest = randomUUID(),
    third = randomUUID(),
    room = randomUUID(),
    problem = randomUUID();
  for (const id of [owner, guest, third])
    await query(
      'INSERT INTO "User" (id,"clerkId","displayName","updatedAt") VALUES ($1,$2,$3,now())',
      [id, `clerk_${id}`, 'Test Student'],
    );
  await query(
    'INSERT INTO "Problem" (id,slug,version,title,"promptMarkdown",language,"starterCode","functionSignature",constraints,comparator) VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9)',
    [
      problem,
      `problem-${problem}`,
      'test',
      'test',
      'python',
      'pass',
      'solve()',
      'test',
      'JSON_EXACT',
    ],
  );
  await query('INSERT INTO "Room" (id,"ownerId",title,"selectedProblemId") VALUES ($1,$2,$3,$4)', [
    room,
    owner,
    'Practice',
    problem,
  ]);
  return { owner, guest, third, room, problem };
}

describe('database guarantees', () => {
  it('rejects a third seat even when the application validation is bypassed', async () => {
    const f = await fixture();
    await query('INSERT INTO "RoomMember" ("roomId","userId",seat,role) VALUES ($1,$2,1,$3)', [
      f.room,
      f.owner,
      'OWNER',
    ]);
    await query('INSERT INTO "RoomMember" ("roomId","userId",seat,role) VALUES ($1,$2,2,$3)', [
      f.room,
      f.guest,
      'PARTICIPANT',
    ]);
    await expect(
      query('INSERT INTO "RoomMember" ("roomId","userId",seat,role) VALUES ($1,$2,3,$3)', [
        f.room,
        f.third,
        'PARTICIPANT',
      ]),
    ).rejects.toThrow(/RoomMember_seat_check/);
  });
  it('rejects two different people occupying the same seat', async () => {
    const f = await fixture();
    await query('INSERT INTO "RoomMember" ("roomId","userId",seat,role) VALUES ($1,$2,2,$3)', [
      f.room,
      f.guest,
      'PARTICIPANT',
    ]);
    await expect(
      query('INSERT INTO "RoomMember" ("roomId","userId",seat,role) VALUES ($1,$2,2,$3)', [
        f.room,
        f.third,
        'PARTICIPANT',
      ]),
    ).rejects.toThrow(/RoomMember_roomId_seat_key/);
  });
  it('protects immutable source snapshots and enforces source size', async () => {
    const f = await fixture(),
      snapshot = randomUUID();
    await query(
      'INSERT INTO "CodeSnapshot" (id,"roomId","problemId",language,"sourceCode","sourceHash",reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [snapshot, f.room, f.problem, 'python', 'pass', 'a'.repeat(64), 'EXECUTION'],
    );
    await expect(
      query('UPDATE "CodeSnapshot" SET "sourceCode"=$1 WHERE id=$2', ['changed', snapshot]),
    ).rejects.toThrow(/Code snapshot contents are immutable/);
    await expect(
      query(
        'INSERT INTO "CodeSnapshot" (id,"roomId","problemId",language,"sourceCode","sourceHash",reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [randomUUID(), f.room, f.problem, 'python', 'x'.repeat(65537), 'a'.repeat(64), 'EXECUTION'],
      ),
    ).rejects.toThrow(/CodeSnapshot_source_size_check/);
  });
  it('rejects duplicate execution requests and snapshots from another room', async () => {
    const f = await fixture(),
      other = await fixture(),
      snapshot = randomUUID();
    await query(
      'INSERT INTO "CodeSnapshot" (id,"roomId","problemId",language,"sourceCode","sourceHash",reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [snapshot, f.room, f.problem, 'python', 'pass', 'a'.repeat(64), 'EXECUTION'],
    );
    const sql =
      'INSERT INTO "Execution" (id,"roomId","requestedById","codeSnapshotId","problemId",language,"idempotencyKey","requestHash") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)';
    const fields = [f.room, f.owner, snapshot, f.problem, 'python', 'repeat-key', 'b'.repeat(64)];
    await query(sql, [randomUUID(), ...fields]);
    await expect(query(sql, [randomUUID(), ...fields])).rejects.toThrow(
      /Execution_roomId_requestedById_idempotencyKey_key/,
    );
    await expect(
      query(sql, [
        randomUUID(),
        other.room,
        other.owner,
        snapshot,
        other.problem,
        'python',
        'different-key',
        'b'.repeat(64),
      ]),
    ).rejects.toThrow(/Execution_snapshot_scope_fkey/);
  });
  it('stores hidden-case verdicts but rejects hidden output previews', async () => {
    const f = await fixture(),
      snapshot = randomUUID(),
      execution = randomUUID(),
      testCase = randomUUID();
    await query(
      'INSERT INTO "CodeSnapshot" (id,"roomId","problemId",language,"sourceCode","sourceHash",reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [snapshot, f.room, f.problem, 'python', 'pass', 'a'.repeat(64), 'EXECUTION'],
    );
    await query(
      'INSERT INTO "Execution" (id,"roomId","requestedById","codeSnapshotId","problemId",language,"idempotencyKey","requestHash") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        execution,
        f.room,
        f.owner,
        snapshot,
        f.problem,
        'python',
        'hidden-test-run',
        'b'.repeat(64),
      ],
    );
    await query(
      'INSERT INTO "TestCase" (id,"problemId",visibility,input,"expectedOutput",ordering) VALUES ($1,$2,$3,$4,$5,0)',
      [testCase, f.problem, 'HIDDEN', '{}', 'true'],
    );
    const result = randomUUID();
    await query(
      'INSERT INTO "ExecutionTestResult" (id,"executionId","testCaseId","problemId",passed) VALUES ($1,$2,$3,$4,true)',
      [result, execution, testCase, f.problem],
    );
    await expect(
      query('UPDATE "ExecutionTestResult" SET "outputPreview"=$1 WHERE id=$2', [
        'private-input-marker',
        result,
      ]),
    ).rejects.toThrow(/Hidden test output must not be persisted/);
    await expect(
      query('UPDATE "ExecutionTestResult" SET "errorPreview"=$1 WHERE id=$2', [
        'private-trace-marker',
        result,
      ]),
    ).rejects.toThrow(/Hidden test output must not be persisted/);
  });
  it('rejects results whose test case belongs to a different problem version', async () => {
    const f = await fixture(),
      other = await fixture(),
      snapshot = randomUUID(),
      execution = randomUUID(),
      testCase = randomUUID();
    await query(
      'INSERT INTO "CodeSnapshot" (id,"roomId","problemId",language,"sourceCode","sourceHash",reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [snapshot, f.room, f.problem, 'python', 'pass', 'a'.repeat(64), 'EXECUTION'],
    );
    await query(
      'INSERT INTO "Execution" (id,"roomId","requestedById","codeSnapshotId","problemId",language,"idempotencyKey","requestHash") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        execution,
        f.room,
        f.owner,
        snapshot,
        f.problem,
        'python',
        'mismatched-test-run',
        'b'.repeat(64),
      ],
    );
    await query(
      'INSERT INTO "TestCase" (id,"problemId",visibility,input,"expectedOutput",ordering) VALUES ($1,$2,$3,$4,$5,0)',
      [testCase, other.problem, 'VISIBLE', '{}', 'true'],
    );
    await expect(
      query(
        'INSERT INTO "ExecutionTestResult" (id,"executionId","testCaseId","problemId",passed) VALUES ($1,$2,$3,$4,true)',
        [randomUUID(), execution, testCase, f.problem],
      ),
    ).rejects.toThrow(/Result_test_scope_fkey/);
  });
});
