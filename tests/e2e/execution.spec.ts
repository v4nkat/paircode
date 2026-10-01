import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

// Component harness with controlled API responses, not a live sandbox test.
test('lost submissions reuse their snapshot and results remain reviewable', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'paircode-runs-'));
  const room = '11111111-1111-4111-8111-111111111111';
  const runId = '22222222-2222-4222-8222-222222222222';
  const olderId = '33333333-3333-4333-8333-333333333333';
  const requests: { key: string | string[] | undefined; sourceCode: string }[] = [];
  let complete = false;
  const attempt = (id = runId) => ({
    id,
    status: complete ? 'PASSED' : 'RUNNING',
    errorCategory: null,
    queuedAt: id === runId ? '2026-09-29T12:00:00Z' : '2026-09-28T12:00:00Z',
    durationMs: complete ? 12 : null,
  });
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url!, 'http://localhost');
      if (url.pathname.startsWith(`/api/rooms/${room}/executions`)) {
        response.setHeader('Content-Type', 'application/json');
        if (request.method === 'POST') {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const body = JSON.parse(Buffer.concat(chunks).toString()) as { sourceCode: string };
          requests.push({ key: request.headers['idempotency-key'], sourceCode: body.sourceCode });
          if (requests.length === 1) {
            response.writeHead(503);
            response.end(
              JSON.stringify({
                error: { message: 'Response lost. Try the same submission again.' },
              }),
            );
          } else response.end(JSON.stringify({ id: runId, status: 'QUEUED' }));
        } else if (url.pathname.endsWith('/executions')) {
          response.end(
            JSON.stringify({
              executions: requests.length
                ? [attempt(url.searchParams.has('cursor') ? olderId : runId)]
                : [],
              nextCursor: url.searchParams.has('cursor') ? null : requests.length ? runId : null,
            }),
          );
        } else
          response.end(
            JSON.stringify({
              execution: attempt(),
              snapshot: {
                sourceCode: requests[0]?.sourceCode ?? '',
                language: 'python',
                title: 'Two Sum',
              },
              visibleResults: complete
                ? [
                    {
                      id: 'example',
                      passed: true,
                      durationMs: 12,
                      outputPreview: '<script>window.injected=true</script>',
                      errorPreview: null,
                    },
                  ]
                : [],
              hiddenSummary: { total: complete ? 3 : 0, passed: complete ? 3 : 0 },
            }),
          );
      } else if (url.pathname === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end(
          '<!doctype html><html lang="en"><title>Execution test harness</title><link rel="stylesheet" href="/panel.css"><div id="root"></div><script type="module" src="/panel.js"></script></html>',
        );
      } else if (['/panel.js', '/panel.css'].includes(url.pathname)) {
        response.setHeader(
          'Content-Type',
          url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript',
        );
        response.end(await readFile(join(directory, url.pathname.slice(1))));
      } else {
        response.writeHead(404);
        response.end();
      }
    })().catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test listener');
  try {
    await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client'; import {ExecutionPanel} from './src/components/execution-panel'; createRoot(document.getElementById('root')).render(<><textarea aria-label="Draft" defaultValue="def two_sum(nums, target): return [0, 1]"/><ExecutionPanel roomId="${room}" problemId="${room}" selectionRevision={0} ready={true} reviewOnly={location.search.includes('review')} getSource={()=>document.querySelector('textarea').value}/></>);`,
        resolveDir: resolve('apps/web'),
        loader: 'tsx',
      },
      bundle: true,
      outfile: join(directory, 'panel.js'),
      format: 'esm',
      jsx: 'automatic',
    });
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.getByRole('button', { name: 'Run Tests', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Response lost');
    await page.getByLabel('Draft').fill('newer unsent draft');
    await page.getByRole('button', { name: 'Retry same submission' }).click();
    await expect(page.getByText('Waiting for the isolated Python runner…')).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    complete = true;
    await expect(page.getByRole('heading', { name: 'All tests passed', exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('Hidden tests: 3 of 3 passed.')).toBeVisible();
    await page.getByText('Code submitted for this attempt').click();
    await expect(page.locator('pre code')).toContainText('def two_sum');
    await expect(page.getByLabel('Draft')).toHaveValue('newer unsent draft');
    await expect(page.locator('script:not([src])')).toHaveCount(0);
    await page.screenshot({ path: resolve('test-results/execution-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Load older attempts' }).click();
    await expect(page.locator('li')).toHaveCount(2);
    await page.goto(`http://127.0.0.1:${address.port}/?review`);
    await expect(page.getByRole('heading', { name: 'Session attempts' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run Tests', exact: true })).toHaveCount(0);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    if (!resolve(directory).startsWith(resolve(tmpdir(), 'paircode-runs-')))
      throw new Error('Unexpected output directory');
    await rm(directory, { recursive: true, force: true });
  }
});
