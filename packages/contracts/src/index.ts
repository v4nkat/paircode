import { z } from 'zod';

export const roomIdSchema = z.uuid();
export const collaborationRequestSchema = z.strictObject({
  clientId: z.number().int().min(0).max(4294967295),
});
export const collaborationIdentitySchema = z.strictObject({
  roomId: z.uuid(),
  userId: z.uuid(),
  clientId: z.number().int().min(0).max(4294967295),
  displayName: z.string().min(1).max(100),
  color: z.enum(['#26724b', '#865cb5']),
});
export type CollaborationIdentity = z.infer<typeof collaborationIdentitySchema>;

export const languageSchema = z.literal('python');
export const executionStatusSchema = z.enum(['QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'ERROR']);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

export const createRoomSchema = z.strictObject({
  title: z.string().trim().min(1).max(100),
  problemId: z.uuid(),
});

export const joinRoomSchema = z.strictObject({
  inviteToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export const runTestsSchema = z.strictObject({
  sourceCode: z
    .string()
    .min(1)
    .refine((source) => new TextEncoder().encode(source).length <= 65536, {
      message: 'Source code exceeds 64 KiB',
    }),
  language: languageSchema,
  problemId: z.uuid(),
  selectionRevision: z.number().int().nonnegative(),
});

export const paginationSchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export interface StoredTestResult {
  id: string;
  visibility: 'VISIBLE' | 'HIDDEN';
  passed: boolean;
  durationMs: number | null;
  outputPreview: string | null;
  errorPreview: string | null;
}

/** Explicit allowlist: hidden stdout can contain intentionally printed private inputs. */
export function publicTestResults(results: readonly StoredTestResult[]) {
  return {
    visibleResults: results
      .filter((result) => result.visibility === 'VISIBLE')
      .map((result) => ({
        id: result.id,
        passed: result.passed,
        durationMs: result.durationMs,
        outputPreview: result.outputPreview,
        errorPreview: result.errorPreview,
      })),
    hiddenSummary: {
      total: results.filter((result) => result.visibility === 'HIDDEN').length,
      passed: results.filter((result) => result.visibility === 'HIDDEN' && result.passed).length,
    },
  };
}

export function canTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return (
    (from === 'QUEUED' && (to === 'RUNNING' || to === 'ERROR')) ||
    (from === 'RUNNING' && (to === 'PASSED' || to === 'FAILED' || to === 'ERROR'))
  );
}
