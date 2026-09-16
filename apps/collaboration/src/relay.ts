import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import * as awareness from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import type { CollaborationIdentity } from '@paircode/contracts';

export interface DocumentRecord {
  state: Uint8Array | null;
  drafts: { id: string; source: string }[];
  selectedProblemId: string;
}
export interface DocumentRepository {
  load(roomId: string): Promise<DocumentRecord>;
  save(
    roomId: string,
    state: Uint8Array,
    sources: Record<string, string>,
    endingUserId?: string,
  ): Promise<void>;
  canAccess(roomId: string, userId: string): Promise<boolean>;
}
type Connection = {
  identity: CollaborationIdentity;
  windowStart: number;
  messages: number;
  alive: boolean;
};
type Room = {
  doc: Y.Doc;
  awareness: awareness.Awareness;
  clients: Map<WebSocket, Connection>;
  ids: Set<string>;
  dirty: boolean;
  frozen: boolean;
  saving: Promise<void>;
  pendingSave: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
  lastSave: number;
  lastActive: number;
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const log = (event: string, roomId?: string) =>
  console.error(JSON.stringify({ service: 'collaboration', event, ...(roomId ? { roomId } : {}) }));

/** Yjs resolves edits. This layer only handles transport, authorization and persistence. */
export function createRelay(options: {
  origin: string;
  repository: DocumentRepository;
  authorize: (token: string, roomId: string) => Promise<CollaborationIdentity | null>;
  controlSecret?: string;
  debounceMs?: number;
}) {
  const rooms = new Map<string, Promise<Room>>();
  let stopping = false;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 128 * 1024,
    perMessageDeflate: false,
  });
  const send = (socket: WebSocket, data: Uint8Array) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > MAX_DOCUMENT_BYTES) {
      socket.close(4408, 'Connection too slow');
      return;
    }
    socket.send(data);
  };
  const broadcast = (room: Room, data: Uint8Array) =>
    room.clients.forEach((_, socket) => send(socket, data));
  const encode = (type: number, write: (encoder: encoding.Encoder) => void) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, type);
    write(encoder);
    return encoding.toUint8Array(encoder);
  };
  const sources = (room: Room) =>
    Object.fromEntries([...room.ids].map((id) => [id, room.doc.getText(id).toString()]));
  function acknowledge(room: Room, saved: Record<string, string>) {
    broadcast(
      room,
      encode(4, (encoder) =>
        encoding.writeVarString(
          encoder,
          JSON.stringify({
            hashes: Object.fromEntries(Object.entries(saved).map(([id, text]) => [id, hash(text)])),
            savedAt: new Date().toISOString(),
          }),
        ),
      ),
    );
  }
  function flush(roomId: string, room: Room, endingUserId?: string): Promise<void> {
    if (!endingUserId && room.pendingSave) return room.pendingSave;
    const save = async () => {
      if (!room.dirty && !endingUserId) {
        acknowledge(room, sources(room));
        return;
      }
      const state = Y.encodeStateAsUpdate(room.doc);
      const snapshot = sources(room);
      room.dirty = false;
      try {
        await options.repository.save(roomId, state, snapshot, endingUserId);
        room.lastSave = Date.now();
        acknowledge(room, snapshot);
      } catch (error) {
        room.dirty = true;
        log('snapshot_failed', roomId);
        throw error;
      }
    };
    const result = room.saving.then(save);
    room.saving = result.catch(() => {});
    if (!endingUserId) {
      room.pendingSave = result;
      void result
        .finally(() => {
          room.pendingSave = null;
          if (room.dirty && !stopping && !room.frozen && !room.timer) {
            room.timer = setTimeout(() => {
              room.timer = null;
              void flush(roomId, room).catch(() => {});
            }, options.debounceMs ?? 1000);
          }
        })
        .catch(() => {});
    }
    return result;
  }
  async function getRoom(roomId: string) {
    let pending = rooms.get(roomId);
    if (!pending) {
      if (rooms.size >= 128) throw new Error('Room capacity reached');
      pending = (async () => {
        const record = await options.repository.load(roomId);
        const doc = new Y.Doc();
        if (record.state) Y.applyUpdate(doc, record.state);
        for (const draft of record.drafts)
          if (!doc.share.has(draft.id)) doc.getText(draft.id).insert(0, draft.source);
        const room: Room = {
          doc,
          awareness: new awareness.Awareness(doc),
          clients: new Map(),
          ids: new Set(record.drafts.map((d) => d.id)),
          dirty: true,
          frozen: false,
          saving: Promise.resolve(),
          pendingSave: null,
          timer: null,
          lastSave: Date.now(),
          lastActive: Date.now(),
        };
        room.awareness.setLocalState(null);
        // Persist starter state before exposing it. Reconnect must never invent a second starter.
        try {
          await flush(roomId, room);
        } catch (error) {
          if (room.timer) clearTimeout(room.timer);
          room.awareness.destroy();
          doc.destroy();
          throw error;
        }
        doc.on('update', (update: Uint8Array) => {
          room.dirty = true;
          room.lastActive = Date.now();
          broadcast(
            room,
            encode(0, (encoder) => sync.writeUpdate(encoder, update)),
          );
          if (room.timer) clearTimeout(room.timer);
          room.timer = setTimeout(
            () => {
              room.timer = null;
              void flush(roomId, room).catch(() => {});
            },
            Math.min(options.debounceMs ?? 1000, Math.max(0, 5000 - (Date.now() - room.lastSave))),
          );
        });
        room.awareness.on(
          'update',
          ({
            added,
            updated,
            removed,
          }: {
            added: number[];
            updated: number[];
            removed: number[];
          }) => {
            broadcast(
              room,
              encode(1, (encoder) =>
                encoding.writeVarUint8Array(
                  encoder,
                  awareness.encodeAwarenessUpdate(room.awareness, [
                    ...added,
                    ...updated,
                    ...removed,
                  ]),
                ),
              ),
            );
          },
        );
        return room;
      })();
      rooms.set(roomId, pending);
      pending.catch(() => {
        if (rooms.get(roomId) === pending) rooms.delete(roomId);
      });
    }
    return pending;
  }
  function applyUpdate(room: Room, bytes: Uint8Array, socket: WebSocket) {
    const candidate = new Y.Doc();
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(room.doc));
      Y.applyUpdate(candidate, bytes);
      if (Y.encodeStateAsUpdate(candidate).byteLength > MAX_DOCUMENT_BYTES)
        throw new Error('Document too large');
      for (const [id] of candidate.share) {
        if (!room.ids.has(id)) throw new Error('Unknown draft');
        if (
          candidate
            .getText(id)
            .toDelta()
            .some((part: { insert?: unknown }) => typeof part.insert !== 'string')
        )
          throw new Error('Only plain text is supported');
        if (Buffer.byteLength(candidate.getText(id).toString(), 'utf8') > 65536)
          throw new Error('Source too large');
      }
      Y.applyUpdate(room.doc, bytes, socket);
    } finally {
      candidate.destroy();
    }
  }
  function applyPresence(room: Room, bytes: Uint8Array, connection: Connection, socket: WebSocket) {
    if (bytes.length > 8192) throw new Error('Presence too large');
    const decoder = decoding.createDecoder(bytes);
    const count = decoding.readVarUint(decoder);
    if (count > 4) throw new Error('Invalid presence count');
    for (let index = 0; index < count; index++) {
      const id = decoding.readVarUint(decoder),
        clock = decoding.readVarUint(decoder);
      const value = decoding.readVarString(decoder);
      // y-websocket echoes remote awareness changes. Ignore those entries: a connection
      // may only update the presence ID bound to its single-use ticket.
      if (id !== connection.identity.clientId) continue;
      const incoming = JSON.parse(value) as {
        selection?: { anchor?: unknown; head?: unknown };
      } | null;
      let selection: { anchor: object; head: object } | undefined;
      if (incoming?.selection?.anchor && incoming.selection.head) {
        const position = (value: unknown) => {
          if (!value || typeof value !== 'object') throw new Error('Invalid selection');
          const relative = Y.createRelativePositionFromJSON(value);
          for (const id of [relative.type, relative.item])
            if (
              id !== null &&
              (!Number.isSafeInteger(id.client) ||
                id.client < 0 ||
                !Number.isSafeInteger(id.clock) ||
                id.clock < 0)
            )
              throw new Error('Invalid relative position');
          if (
            !Number.isSafeInteger(relative.assoc) ||
            (relative.tname !== null && !room.ids.has(relative.tname))
          )
            throw new Error('Invalid relative position');
          // y-monaco consumes full RelativePosition objects, including their null fields.
          return relative;
        };
        selection = {
          anchor: position(incoming.selection.anchor),
          head: position(incoming.selection.head),
        };
      }
      const identity = connection.identity;
      const state =
        incoming === null
          ? null
          : {
              user: { id: identity.userId, name: identity.displayName, color: identity.color },
              ...(selection ? { selection } : {}),
            };
      const sanitized = encoding.createEncoder();
      encoding.writeVarUint(sanitized, 1);
      encoding.writeVarUint(sanitized, id);
      encoding.writeVarUint(sanitized, clock);
      encoding.writeVarString(sanitized, JSON.stringify(state));
      awareness.applyAwarenessUpdate(room.awareness, encoding.toUint8Array(sanitized), socket);
    }
  }
  function attach(roomId: string, room: Room, socket: WebSocket, identity: CollaborationIdentity) {
    const connection: Connection = { identity, windowStart: Date.now(), messages: 0, alive: true };
    room.clients.set(socket, connection);
    room.lastActive = Date.now();
    socket.on('error', () => socket.terminate());
    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('message', (data, binary) => {
      if (room.frozen || stopping) {
        socket.close(4403, 'Room closed');
        return;
      }
      try {
        if (!binary) throw new Error('Binary messages required');
        if (Date.now() - connection.windowStart > 10000) {
          connection.windowStart = Date.now();
          connection.messages = 0;
        }
        if (++connection.messages > 600) {
          socket.close(4429, 'Too many updates');
          return;
        }
        const bytes =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : Buffer.concat(Array.isArray(data) ? data : [data]);
        const decoder = decoding.createDecoder(bytes),
          type = decoding.readVarUint(decoder);
        if (type === 0) {
          const kind = decoding.readVarUint(decoder);
          if (kind === sync.messageYjsSyncStep1)
            send(
              socket,
              encode(0, (encoder) => sync.readSyncStep1(decoder, encoder, room.doc)),
            );
          else if (kind === sync.messageYjsSyncStep2 || kind === sync.messageYjsUpdate)
            applyUpdate(room, decoding.readVarUint8Array(decoder), socket);
          else throw new Error('Unknown sync message');
        } else if (type === 1)
          applyPresence(room, decoding.readVarUint8Array(decoder), connection, socket);
        else if (type === 3)
          send(
            socket,
            encode(1, (encoder) =>
              encoding.writeVarUint8Array(
                encoder,
                awareness.encodeAwarenessUpdate(room.awareness, [
                  ...room.awareness.getStates().keys(),
                ]),
              ),
            ),
          );
        else throw new Error('Unknown message');
      } catch {
        socket.close(4400, 'Invalid update');
      }
    });
    socket.on('close', () => {
      room.clients.delete(socket);
      room.lastActive = Date.now();
      if (![...room.clients.values()].some((c) => c.identity.clientId === identity.clientId))
        awareness.removeAwarenessStates(room.awareness, [identity.clientId], null);
      if (!stopping && !room.clients.size) void flush(roomId, room).catch(() => {});
    });
    send(
      socket,
      encode(0, (encoder) => sync.writeSyncStep1(encoder, room.doc)),
    );
    send(
      socket,
      encode(1, (encoder) =>
        encoding.writeVarUint8Array(
          encoder,
          awareness.encodeAwarenessUpdate(room.awareness, [...room.awareness.getStates().keys()]),
        ),
      ),
    );
    void room.saving.then(() => {
      if (!room.dirty) acknowledge(room, sources(room));
    });
  }
  async function endRoom(roomId: string, userId: string) {
    const room = await getRoom(roomId);
    room.frozen = true;
    try {
      await flush(roomId, room, userId);
    } catch (error) {
      room.frozen = false;
      throw error;
    }
    room.clients.forEach((_, socket) => socket.close(4403, 'Room ended'));
  }
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      response.writeHead(stopping ? 503 : 200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify({ service: 'collaboration', collaborationReady: !stopping }));
      return;
    }
    const match = /^\/internal\/rooms\/([0-9a-f-]{36})\/end$/i.exec(request.url || '');
    if (request.method === 'POST' && match && options.controlSecret) {
      const actual = createHash('sha256')
        .update(request.headers.authorization || '')
        .digest();
      const expected = createHash('sha256')
        .update('Bearer ' + options.controlSecret)
        .digest();
      const userId = request.headers['x-paircode-user'];
      if (
        !timingSafeEqual(actual, expected) ||
        typeof userId !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(userId)
      ) {
        response.writeHead(403);
        response.end();
        return;
      }
      void endRoom(match[1]!, userId)
        .then(() => {
          response.writeHead(204);
          response.end();
        })
        .catch(() => {
          response.writeHead(503);
          response.end();
        });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.on('upgrade', (request, socket, head) => {
    const reject = (status: number) =>
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    const timeout = setTimeout(() => socket.destroy(), 10000);
    void (async () => {
      if (stopping || request.headers.origin !== options.origin) {
        reject(403);
        return;
      }
      const url = new URL(request.url || '/', 'http://relay');
      const roomId = url.pathname.slice(1);
      if (!/^[0-9a-f-]{36}$/i.test(roomId)) {
        reject(404);
        return;
      }
      const identity = await options.authorize(url.searchParams.get('ticket') || '', roomId);
      if (
        !identity ||
        identity.roomId !== roomId ||
        !(await options.repository.canAccess(roomId, identity.userId))
      ) {
        reject(401);
        return;
      }
      const room = await getRoom(roomId);
      // A freshly authorized reconnect may arrive before the old socket's close event.
      for (const [previous, connection] of room.clients) {
        if (
          connection.identity.clientId === identity.clientId &&
          connection.identity.userId === identity.userId
        ) {
          room.clients.delete(previous);
          previous.terminate();
        }
      }
      if (
        room.frozen ||
        room.clients.size >= 4 ||
        [...room.clients.values()].some((c) => c.identity.clientId === identity.clientId)
      ) {
        reject(409);
        return;
      }
      if (!socket.destroyed)
        wss.handleUpgrade(request, socket, head, (ws) => attach(roomId, room, ws, identity));
    })()
      .catch(() => {
        log('upgrade_failed');
        if (!socket.destroyed) reject(503);
      })
      .finally(() => clearTimeout(timeout));
  });
  let checking = false;
  const heartbeat = setInterval(() => {
    if (checking || stopping) return;
    checking = true;
    void (async () => {
      for (const [roomId, pending] of rooms) {
        const room = await pending;
        for (const [socket, connection] of room.clients) {
          let active = false;
          try {
            active = await options.repository.canAccess(roomId, connection.identity.userId);
          } catch {
            log('membership_check_failed', roomId);
          }
          if (!active) {
            socket.close(4403, 'Room unavailable');
            continue;
          }
          if (!connection.alive) {
            socket.terminate();
            continue;
          }
          connection.alive = false;
          socket.ping();
        }
        if (room.dirty) await flush(roomId, room).catch(() => {});
        if (!room.clients.size && !room.dirty && Date.now() - room.lastActive > 60000) {
          rooms.delete(roomId);
          if (room.timer) clearTimeout(room.timer);
          room.awareness.destroy();
          room.doc.destroy();
        }
      }
    })()
      .catch(() => log('maintenance_failed'))
      .finally(() => {
        checking = false;
      });
  }, 10000);
  heartbeat.unref();
  return {
    server,
    endRoom,
    async close() {
      stopping = true;
      clearInterval(heartbeat);
      for (const [roomId, pending] of rooms) {
        const room = await pending;
        if (room.timer) clearTimeout(room.timer);
        room.clients.forEach((_, socket) => socket.terminate());
        await flush(roomId, room);
        room.awareness.destroy();
        room.doc.destroy();
      }
      rooms.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
