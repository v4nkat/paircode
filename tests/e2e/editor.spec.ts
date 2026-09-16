import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { createRelay } from '../../apps/collaboration/src/relay.js';
import type { CollaborationIdentity } from '@paircode/contracts';

// This standalone harness injects test identities. It is never an application route
// and cannot enable unauthenticated access in a running PairCode deployment.
test('two browsers edit, show remote cursors, and restore a saved document', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const directory = await mkdtemp(join(tmpdir(), 'paircode-editor-'));
  const roomId = randomUUID(),
    problemId = randomUUID(),
    owner = randomUUID(),
    guest = randomUUID();
  const tickets = new Map<string, CollaborationIdentity>();
  let state: Uint8Array | null = null;
  let saved = '';
  const web = createServer((request, response) => {
    void (async () => {
      if (request.url === `/api/rooms/${roomId}/collaboration-ticket`) {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const { clientId } = JSON.parse(Buffer.concat(chunks).toString());
        const userId = request.headers.cookie?.includes('test-user=owner') ? owner : guest;
        const identity: CollaborationIdentity = {
          roomId,
          clientId,
          userId,
          displayName: userId === owner ? 'Maya' : 'Alex',
          color: userId === owner ? '#26724b' : '#865cb5',
        };
        const ticket = randomUUID();
        tickets.set(ticket, identity);
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ ticket, identity, url: relayUrl }));
      } else if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end(
          '<!doctype html><html lang="en"><meta charset="utf-8"><title>PairCode editor test</title><link rel="stylesheet" href="/editor.css"><body style="background:#f7f6f0;margin:32px"><div id="root"></div><script type="module" src="/editor.js"></script></body></html>',
        );
      } else if (['/editor.js', '/editor.css', '/editor.worker.js'].includes(request.url || '')) {
        response.setHeader(
          'Content-Type',
          request.url?.endsWith('.css') ? 'text/css' : 'application/javascript',
        );
        response.end(await readFile(join(directory, request.url!.slice(1))));
      } else {
        response.writeHead(404);
        response.end();
      }
    })().catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((done) => web.listen(0, '127.0.0.1', done));
  const address = web.address();
  if (!address || typeof address === 'string') throw new Error('Missing test listener');
  const origin = `http://127.0.0.1:${address.port}`;
  const relay = createRelay({
    origin,
    debounceMs: 50,
    authorize: async (token) => {
      const identity = tickets.get(token);
      tickets.delete(token);
      return identity ?? null;
    },
    repository: {
      async load() {
        return {
          state,
          drafts: [{ id: problemId, source: 'pass\n' }],
          selectedProblemId: problemId,
        };
      },
      async save(_id, next, sources) {
        state = new Uint8Array(next);
        saved = sources[problemId]!;
      },
      async canAccess(id, userId) {
        return id === roomId && (userId === owner || userId === guest);
      },
    },
  });
  await new Promise<void>((done) => relay.server.listen(0, '127.0.0.1', done));
  const relayAddress = relay.server.address();
  if (!relayAddress || typeof relayAddress === 'string') throw new Error('Missing relay listener');
  const relayUrl = `ws://127.0.0.1:${relayAddress.port}`;
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const webRoot = resolve('apps/web');
    await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client'; import Editor from './src/components/shared-editor'; createRoot(document.getElementById('root')).render(<Editor roomId="${roomId}" problemId="${problemId}" />);`,
        resolveDir: webRoot,
        loader: 'tsx',
      },
      bundle: true,
      outfile: join(directory, 'editor.js'),
      format: 'esm',
      jsx: 'automatic',
      loader: { '.ttf': 'dataurl' },
      plugins: [
        {
          name: 'test-worker-entry',
          setup(builder) {
            builder.onLoad({ filter: /shared-editor\.tsx$/ }, async ({ path }) => ({
              contents: (await readFile(path, 'utf8')).replace(
                "new URL('./editor.worker.ts', import.meta.url)",
                "new URL('/editor.worker.js', window.location.href)",
              ),
              loader: 'tsx',
              resolveDir: resolve(path, '..'),
            }));
          },
        },
      ],
    });
    await build({
      entryPoints: [resolve(webRoot, 'src/components/editor.worker.ts')],
      bundle: true,
      outfile: join(directory, 'editor.worker.js'),
      format: 'esm',
    });
    await contexts[0]!.addCookies([{ name: 'test-user', value: 'owner', url: origin }]);
    const [a, b] = await Promise.all(contexts.map((context) => context.newPage()));
    const errors: string[] = [];
    for (const page of [a!, b!]) page.on('pageerror', (error) => errors.push(error.message));
    await Promise.all([a!.goto(origin), b!.goto(origin)]);
    await expect(a!.getByRole('status')).toHaveText('Live · Saved');
    await expect(b!.getByRole('status')).toHaveText('Live · Saved');
    await expect(a!.getByLabel('Online participants')).toContainText('Alex');
    await expect(b!.getByLabel('Online participants')).toContainText('Maya');
    const first = a!.getByRole('textbox', { name: 'Shared Python editor' });
    await first.focus();
    await first.press('Control+Home');
    await first.pressSequentially('# first browser');
    await first.press('Enter');
    await expect.poll(() => saved).toContain('# first browser');
    await expect(b!.locator('.view-lines')).toContainText('# first browser');
    const second = b!.getByRole('textbox', { name: 'Shared Python editor' });
    await second.focus();
    await second.press('Control+Home');
    await second.pressSequentially('# second browser');
    await second.press('Enter');
    await expect(a!.locator('.view-lines')).toContainText('# second browser');
    await expect(a!.locator('[class*="yRemoteSelectionHead-"]').first()).toBeAttached();
    await expect(a!.getByRole('status')).toHaveText('Live · Saved');
    await b!.reload();
    await expect(b!.getByRole('status')).toHaveText('Live · Saved');
    await expect(b!.locator('.view-lines')).toContainText('# first browser');
    await expect(b!.locator('.view-lines')).toContainText('# second browser');
    await a!.screenshot({ path: resolve('test-results/editor-desktop.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await relay.close();
    await new Promise<void>((done) => web.close(() => done()));
    // mkdtemp supplies this exact test-owned directory, never a user path.
    if (!resolve(directory).startsWith(resolve(tmpdir(), 'paircode-editor-')))
      throw new Error('Unexpected test output directory');
    await rm(directory, { recursive: true, force: true });
  }
});
