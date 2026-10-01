import { randomUUID } from 'node:crypto';
import {
  collaborationRequestSchema,
  createRoomSchema,
  joinRoomSchema,
  roomIdSchema,
  runTestsSchema,
  selectProblemSchema,
} from '@paircode/contracts';
import { RoomError } from '@paircode/database/rooms';
import type { RoomService } from '@paircode/database/rooms';
import type { executionService } from '@paircode/database/executions';

const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
async function body(request: Request, maximum = 16384) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new RoomError(415, 'JSON_REQUIRED', 'Send this request as JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new RoomError(422, 'INVALID_BODY', 'A request body is required.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new RoomError(413, 'BODY_TOO_LARGE', 'This request is too large.');
      }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) {
    if (error instanceof RoomError) throw error;
    throw new RoomError(422, 'INVALID_BODY', 'The request could not be read.');
  } finally {
    reader.releaseLock();
  }
}

// Authentication is injected for integration tests, never selected through a runtime bypass flag.
export function createRoomApi(deps: {
  service: () => RoomService;
  authenticate: () => Promise<string | null>;
  origin: () => string | undefined;
  collaborationTicket?: (userId: string, roomId: string, clientId: number) => Promise<unknown>;
  endRoom?: (userId: string, roomId: string) => Promise<unknown>;
  executions?: () => ReturnType<typeof executionService>;
  dispatchExecution?: (id: string) => Promise<void>;
}) {
  return async (request: Request, segments: string[]) => {
    const requestId = randomUUID();
    try {
      const userId = await deps.authenticate();
      if (!userId) throw new RoomError(401, 'SIGN_IN_REQUIRED', 'Sign in to continue.');
      if (request.method !== 'GET') {
        const origin = deps.origin();
        if (!origin)
          throw new RoomError(
            503,
            'NOT_CONFIGURED',
            'Rooms are not available yet. Please try again later.',
          );
        if (request.headers.get('origin') !== new URL(origin).origin)
          throw new RoomError(403, 'ORIGIN_REJECTED', 'Open PairCode directly and try again.');
      }
      const service = deps.service();
      let output: unknown;
      let status = 200;
      if (segments.length === 0 && request.method === 'GET') {
        const cursor = new URL(request.url).searchParams.get('cursor') ?? undefined;
        if (cursor && !roomIdSchema.safeParse(cursor).success)
          throw new RoomError(422, 'INVALID_CURSOR', 'Reload the room list.');
        output = await service.list(userId, cursor);
      } else if (segments.length === 0 && request.method === 'POST') {
        const parsed = createRoomSchema.safeParse(await body(request));
        if (!parsed.success)
          throw new RoomError(
            422,
            'INVALID_ROOM',
            'Enter a title of up to 100 characters and choose a problem.',
          );
        output = await service.create(userId, parsed.data);
        status = 201;
      } else if (segments.length === 1 && segments[0] === 'problems' && request.method === 'GET') {
        output = { problems: await service.problems() };
      } else if (segments.length === 1 && segments[0] === 'join' && request.method === 'POST') {
        const parsed = joinRoomSchema.safeParse(await body(request));
        if (!parsed.success)
          throw new RoomError(
            422,
            'INVALID_INVITE',
            'This invitation is incomplete. Ask for a new link.',
          );
        output = await service.join(userId, parsed.data.inviteToken);
      } else {
        const id = roomIdSchema.safeParse(segments[0]);
        if (!id.success) throw new RoomError(404, 'NOT_FOUND', 'This page is not available.');
        if ((segments.length === 2 || segments.length === 3) && segments[1] === 'executions') {
          if (!deps.executions)
            throw new RoomError(503, 'NOT_CONFIGURED', 'Python execution is not configured yet.');
          const executions = deps.executions();
          if (segments.length === 2 && request.method === 'POST') {
            const parsed = runTestsSchema.safeParse(await body(request, 400000));
            const key = request.headers.get('idempotency-key');
            if (!parsed.success || !key || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
              throw new RoomError(
                422,
                'INVALID_RUN',
                'Send Python code, the current problem, and a valid request key.',
              );
            const run = await executions.submit(userId, id.data, parsed.data, key);
            if (run.status === 'QUEUED' && deps.dispatchExecution) {
              try {
                await deps.dispatchExecution(run.id);
              } catch {
                console.error(
                  JSON.stringify({ requestId, category: 'dispatch_pending', executionId: run.id }),
                );
              }
            }
            output = run;
            status = 202;
          } else if (segments.length === 2 && request.method === 'GET') {
            const cursor = new URL(request.url).searchParams.get('cursor') ?? undefined;
            if (cursor && !roomIdSchema.safeParse(cursor).success)
              throw new RoomError(422, 'INVALID_CURSOR', 'Reload the execution list.');
            output = await executions.list(userId, id.data, cursor);
          } else if (
            segments.length === 3 &&
            request.method === 'GET' &&
            roomIdSchema.safeParse(segments[2]).success
          )
            output = await executions.detail(userId, id.data, segments[2]!);
          else throw new RoomError(404, 'NOT_FOUND', 'This action is not available.');
        } else if (segments.length === 2 && segments[1] === 'review' && request.method === 'GET') {
          const cursor = new URL(request.url).searchParams.get('cursor') ?? undefined;
          if (cursor && !roomIdSchema.safeParse(cursor).success)
            throw new RoomError(422, 'INVALID_CURSOR', 'Reload the session timeline.');
          output = await service.review(userId, id.data, cursor);
        } else if (segments.length === 1 && request.method === 'GET')
          output = await service.detail(userId, id.data);
        else if (segments.length === 2 && segments[1] === 'problem' && request.method === 'POST') {
          const parsed = selectProblemSchema.safeParse(await body(request));
          if (!parsed.success)
            throw new RoomError(422, 'INVALID_PROBLEM', 'Choose an available problem.');
          output = await service.selectProblem(
            userId,
            id.data,
            parsed.data.problemId,
            parsed.data.selectionRevision,
          );
        } else if (segments.length === 2 && segments[1] === 'invite' && request.method === 'POST')
          output = await service.rotateInvite(userId, id.data);
        else if (
          segments.length === 2 &&
          segments[1] === 'collaboration-ticket' &&
          request.method === 'POST'
        ) {
          const parsed = collaborationRequestSchema.safeParse(await body(request));
          if (!parsed.success)
            throw new RoomError(422, 'INVALID_CLIENT', 'Reload the editor and try again.');
          if (!deps.collaborationTicket)
            throw new RoomError(503, 'NOT_CONFIGURED', 'Shared editing is not configured yet.');
          output = await deps.collaborationTicket(userId, id.data, parsed.data.clientId);
        } else if (segments.length === 2 && segments[1] === 'end' && request.method === 'POST')
          output = await (deps.endRoom ?? service.end)(userId, id.data);
        else throw new RoomError(404, 'NOT_FOUND', 'This action is not available.');
      }
      return Response.json(output, { status, headers });
    } catch (error) {
      const failure =
        error instanceof RoomError
          ? error
          : new RoomError(
              503,
              'TEMPORARILY_UNAVAILABLE',
              'Rooms are temporarily unavailable. Please try again.',
            );
      // No request bodies, invite URLs, SQL errors, or credentials in logs.
      if (!(error instanceof RoomError))
        console.error(JSON.stringify({ requestId, category: 'room_request_failed' }));
      return Response.json(
        { error: { code: failure.code, message: failure.message, requestId } },
        {
          status: failure.status,
          headers: { ...headers, ...(failure.status === 429 ? { 'Retry-After': '60' } : {}) },
        },
      );
    }
  };
}
