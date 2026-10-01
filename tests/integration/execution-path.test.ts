import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { migrationSql } from '../support/migrations.js';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createRoomService } from '../../packages/database/src/rooms.js';
import type { RoomStore } from '../../packages/database/src/rooms.js';
import { executionRepository, executionService } from '../../packages/database/src/executions.js';
import { executionQueue, executionWorker } from '../../packages/queue/src/transport.js';
import { executionProcessor } from '../../apps/worker/src/process-execution.js';
import { judge0 } from '../../apps/worker/src/sandbox.js';

// CI supplies disposable PostgreSQL and Redis services. The HTTP server stands in for Judge0;
// it checks the wire contract without pretending to verify a real sandbox's isolation.
describe.skipIf(!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)(
  'execution path with PostgreSQL, Redis, and the HTTP sandbox adapter',
  () => {
    it('delivers a queued run after the worker starts and keeps hidden output private', async () => {
      const schema = `execution_${randomUUID().replaceAll('-', '')}`;
      const queueName = `paircode-test-${randomUUID()}`;
      const control = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
      let connected = false;
      let pool: pg.Pool | undefined;
      let queue: ReturnType<typeof executionQueue> | undefined;
      let worker: ReturnType<typeof executionWorker> | undefined;
      const submitted: {
        source: string;
        input: { nums: number[]; target: number };
        body: Record<string, unknown>;
      }[] = [];
      const tokens = new Map<string, { nums: number[]; target: number }>();
      const sandboxServer = createServer((request, response) => {
        void (async () => {
          const url = new URL(request.url ?? '/', 'http://localhost');
          response.setHeader('Content-Type', 'application/json');
          if (request.method === 'POST' && url.pathname === '/submissions') {
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(Buffer.from(chunk));
            const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
            const source = Buffer.from(String(body.source_code), 'base64').toString();
            const input = JSON.parse(Buffer.from(String(body.stdin), 'base64').toString()) as {
              nums: number[];
              target: number;
            };
            submitted.push({ source, input, body });
            const token = randomUUID();
            tokens.set(token, input);
            response.writeHead(201);
            response.end(JSON.stringify({ token }));
          } else if (request.method === 'GET' && url.pathname.startsWith('/submissions/')) {
            const input = tokens.get(url.pathname.slice('/submissions/'.length));
            if (!input) {
              response.writeHead(404);
              response.end('{}');
              return;
            }
            const value = input.target === 9 ? [0, 1] : [1, 2];
            const output = input.target === 9 ? 'visible output' : 'hidden output canary';
            response.end(
              JSON.stringify({
                status: { id: 3 },
                stdout: Buffer.from(JSON.stringify({ kind: 'result', value, output })).toString(
                  'base64',
                ),
                time: '0.012',
                memory: 4096,
              }),
            );
          } else {
            response.writeHead(404);
            response.end('{}');
          }
        })().catch(() => {
          response.writeHead(500);
          response.end('{}');
        });
      });
      await new Promise<void>((done) => sandboxServer.listen(0, '127.0.0.1', done));
      try {
        await control.connect();
        connected = true;
        await control.query(`CREATE SCHEMA "${schema}"`);
        await control.query(`SET search_path TO "${schema}"`);
        await control.query(
          (await migrationSql())
            .replaceAll('"public".', `"${schema}".`)
            .replaceAll('CREATE SCHEMA IF NOT EXISTS "public";', ''),
        );
        pool = new pg.Pool({
          connectionString: process.env.TEST_DATABASE_URL,
          options: `-c search_path=${schema}`,
          max: 5,
        });
        const activePool = pool;
        const store: RoomStore = {
          query: (text, values) => activePool.query(text, values),
          async transaction(work) {
            const client = await activePool.connect();
            try {
              await client.query('BEGIN');
              const result = await work(client);
              await client.query('COMMIT');
              return result;
            } catch (error) {
              await client.query('ROLLBACK');
              throw error;
            } finally {
              client.release();
            }
          },
        };
        const problemId = randomUUID();
        const hiddenInput = { nums: [3, 2, 4], target: 6 };
        await store.query(
          "INSERT INTO \"Problem\" (id,slug,version,title,\"promptMarkdown\",language,\"starterCode\",\"functionSignature\",constraints,comparator) VALUES ($1,'two-sum',1,'Two Sum','Find a pair','python','pass','two_sum(nums, target)','Small inputs','UNORDERED_INTEGER_PAIR')",
          [problemId],
        );
        await store.query(
          'INSERT INTO "TestCase" (id,"problemId",visibility,input,"expectedOutput",ordering) VALUES ($1,$2,\'VISIBLE\',$3,$4,0),($5,$2,\'HIDDEN\',$6,$7,1)',
          [
            randomUUID(),
            problemId,
            JSON.stringify({ nums: [2, 7], target: 9 }),
            JSON.stringify([0, 1]),
            randomUUID(),
            JSON.stringify(hiddenInput),
            JSON.stringify([1, 2]),
          ],
        );
        const rooms = createRoomService(store);
        const owner = await rooms.syncUser(randomUUID(), 'Owner');
        const { roomId } = await rooms.create(owner, { title: 'Queue test', problemId });
        const runs = executionService(store);
        const sourceCode = 'def two_sum(nums, target):\n    return [0, 1]';
        const run = await runs.submit(
          owner,
          roomId,
          { sourceCode, language: 'python', problemId, selectionRevision: 0 },
          randomUUID(),
        );
        expect((await runs.detail(owner, roomId, run.id)).execution.status).toBe('QUEUED');

        const address = sandboxServer.address();
        if (!address || typeof address === 'string')
          throw new Error('Missing mock sandbox listener');
        const sandbox = judge0({
          url: `http://127.0.0.1:${address.port}`,
          token: 'test-only-token',
          languageId: 71,
          cpuSeconds: 2,
          wallSeconds: 10,
          memoryKb: 131072,
        });
        queue = executionQueue(process.env.TEST_REDIS_URL!, queueName);
        await queue.dispatch(run.id);
        worker = executionWorker(
          process.env.TEST_REDIS_URL!,
          executionProcessor(executionRepository(store), sandbox),
          queueName,
        );
        await expect
          .poll(async () => (await runs.detail(owner, roomId, run.id)).execution.status, {
            timeout: 15000,
            interval: 100,
          })
          .toBe('PASSED');

        const detail = await runs.detail(owner, roomId, run.id);
        expect(detail.snapshot?.sourceCode).toBe(sourceCode);
        expect(detail.visibleResults).toMatchObject([
          { passed: true, outputPreview: 'visible output' },
        ]);
        expect(detail.hiddenSummary).toEqual({ total: 1, passed: 1 });
        expect(submitted).toHaveLength(2);
        for (const submission of submitted) {
          expect(submission.source).toContain(Buffer.from(sourceCode).toString('base64'));
          expect(submission.body).toMatchObject({ enable_network: false, language_id: 71 });
          expect(submission.body).not.toHaveProperty('expected_output');
        }
        expect(JSON.stringify(detail)).not.toContain('hidden output canary');
        expect(JSON.stringify(detail)).not.toContain('sandboxToken');
        expect(
          (
            await store.query(
              'SELECT "outputPreview" FROM "ExecutionTestResult" WHERE "executionId"=$1 ORDER BY "testCaseId"',
              [run.id],
            )
          ).rows.map((row) => row.outputPreview),
        ).toContain(null);
      } finally {
        await worker?.close();
        await queue?.close();
        await pool?.end();
        if (connected) {
          await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
          await control.end();
        }
        await new Promise<void>((done) => sandboxServer.close(() => done()));
      }
    });
  },
);
