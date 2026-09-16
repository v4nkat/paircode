import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { createRelay } from '../../apps/collaboration/src/relay.js';
import type { DocumentRepository } from '../../apps/collaboration/src/relay.js';
import type { CollaborationIdentity } from '@paircode/contracts';

const origin = 'https://paircode.example';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function eventually(check: () => boolean) {
  const deadline = Date.now() + 6000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Condition did not become true');
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}
async function fixture() {
  const roomId = randomUUID(),
    problemId = randomUUID(),
    owner = randomUUID(),
    guest = randomUUID();
  let state: Uint8Array | null = null;
  let active = true;
  let loads = 0;
  const saved: Record<string, string>[] = [];
  const tickets = new Map<string, CollaborationIdentity>();
  const repository: DocumentRepository = {
    async load() {
      loads++;
      return { state, drafts: [{ id: problemId, source: 'pass\n' }], selectedProblemId: problemId };
    },
    async save(_roomId, next, sources, endingUserId) {
      if (endingUserId && endingUserId !== owner) throw new Error('Owner required');
      state = new Uint8Array(next);
      saved.push(sources);
      if (endingUserId) active = false;
    },
    async canAccess(id, userId) {
      return active && id === roomId && (userId === owner || userId === guest);
    },
  };
  const relay = createRelay({
    origin,
    repository,
    debounceMs: 20,
    authorize: async (token, id) => {
      const identity = tickets.get(token);
      tickets.delete(token);
      return identity?.roomId === id ? identity : null;
    },
  });
  await new Promise<void>((resolve) => relay.server.listen(0, '127.0.0.1', resolve));
  const address = relay.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing listener');
  const url = `ws://127.0.0.1:${address.port}`;
  cleanup.push(() => relay.close());
  function issue(doc: Y.Doc, userId: string) {
    const token = randomUUID();
    tickets.set(token, {
      roomId,
      userId,
      clientId: doc.clientID,
      displayName: userId === owner ? 'Owner' : 'Guest',
      color: userId === owner ? '#26724b' : '#865cb5',
    });
    return token;
  }
  function peer(userId: string) {
    const doc = new Y.Doc();
    class ClientSocket extends WebSocket {
      constructor(address: string | URL, protocols?: string | string[]) {
        super(address, protocols, { origin });
      }
    }
    const provider = new WebsocketProvider(url, roomId, doc, {
      params: { ticket: issue(doc, userId) },
      connect: false,
      disableBc: true,
      shouldReconnect: () => false,
      WebSocketPolyfill: ClientSocket as unknown as typeof globalThis.WebSocket,
    });
    provider.messageHandlers[4] = () => {}; // Persistence acknowledgement is tested through saved records here.
    provider.connect();
    cleanup.push(async () => {
      provider.destroy();
      doc.destroy();
    });
    return {
      doc,
      provider,
      text: doc.getText(problemId),
      reconnect() {
        provider.params = { ticket: issue(doc, userId) };
        provider.connect();
      },
    };
  }
  return {
    roomId,
    problemId,
    owner,
    guest,
    url,
    peer,
    relay,
    saved,
    repository,
    get loads() {
      return loads;
    },
    get state() {
      return state;
    },
  };
}
describe('authenticated collaboration transport', () => {
  it('converges concurrent edits and replaces client-supplied presence names', async () => {
    const f = await fixture();
    const a = f.peer(f.owner),
      b = f.peer(f.guest);
    await eventually(() => a.provider.synced && b.provider.synced);
    expect(a.text.toString()).toBe('pass\n');
    expect(b.text.toString()).toBe('pass\n');
    a.text.insert(0, '# from a\n');
    b.text.insert(0, '# from b\n');
    await eventually(() => a.text.toString() === b.text.toString());
    expect(a.text.toString()).toContain('# from a');
    expect(a.text.toString()).toContain('# from b');
    a.provider.awareness.setLocalStateField('user', { name: 'Spoofed name', color: 'red' });
    await eventually(() => b.provider.awareness.getStates().has(a.doc.clientID));
    expect(b.provider.awareness.getStates().get(a.doc.clientID)?.user).toMatchObject({
      id: f.owner,
      name: 'Owner',
      color: '#26724b',
    });
    await eventually(() => f.saved.some((s) => s[f.problemId] === a.text.toString()));
  });
  it('merges offline edits with newer remote edits using a fresh ticket', async () => {
    const f = await fixture();
    const a = f.peer(f.owner),
      b = f.peer(f.guest);
    await eventually(() => a.provider.synced && b.provider.synced);
    a.provider.disconnect();
    await eventually(() => !a.provider.wsconnected);
    a.text.insert(0, '# offline\n');
    b.text.insert(0, '# remote\n');
    a.reconnect();
    await eventually(() => a.provider.synced && a.text.toString() === b.text.toString());
    expect(a.text.toString()).toContain('# offline');
    expect(a.text.toString()).toContain('# remote');
    expect(a.text.toString().match(/pass/g)).toHaveLength(1);
  });
  it('rejects missing authorization and foreign origins before loading a document', async () => {
    const f = await fixture();
    async function rejected(requestOrigin: string) {
      return new Promise<number>((resolve) => {
        const socket = new WebSocket(`${f.url}/${f.roomId}?ticket=invalid`, {
          origin: requestOrigin,
        });
        socket.on('unexpected-response', (_request, response) => {
          const status = response.statusCode || 0;
          response.destroy();
          socket.terminate();
          resolve(status);
        });
        socket.on('error', () => {});
      });
    }
    expect(await rejected(origin)).toBe(401);
    expect(await rejected('https://other.example')).toBe(403);
    expect(f.loads).toBe(0);
  });
  it('rejects oversized code without persisting the rejected update', async () => {
    const f = await fixture();
    const a = f.peer(f.owner),
      b = f.peer(f.guest);
    await eventually(() => a.provider.synced && b.provider.synced);
    a.text.insert(0, 'x'.repeat(66000));
    await eventually(() => !a.provider.wsconnected);
    expect(b.text.toString()).toBe('pass\n');
    expect(f.saved.every((s) => (s[f.problemId]?.length ?? 0) < 65536)).toBe(true);
  });
  it('flushes a final snapshot before closing the room and rejects a non-owner end', async () => {
    const f = await fixture();
    const a = f.peer(f.owner);
    await eventually(() => a.provider.synced);
    await expect(f.relay.endRoom(f.roomId, f.guest)).rejects.toThrow('Owner required');
    a.text.insert(0, '# final\n');
    await eventually(() => f.saved.some((s) => s[f.problemId]?.includes('# final')));
    await f.relay.endRoom(f.roomId, f.owner);
    await eventually(() => !a.provider.wsconnected);
    expect(f.saved.at(-1)?.[f.problemId]).toBe('# final\npass\n');
    const restored = new Y.Doc();
    Y.applyUpdate(restored, f.state!);
    expect(restored.getText(f.problemId).toString()).toBe('# final\npass\n');
    restored.destroy();
  });
});
