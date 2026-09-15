import { describe, expect, it } from 'vitest';
import {
  runTestsSchema,
  joinRoomSchema,
  publicTestResults,
  canTransition,
} from '@paircode/contracts';

const validRun = {
  sourceCode: 'print(1)',
  language: 'python',
  problemId: '11111111-1111-4111-8111-111111111111',
  selectionRevision: 0,
};
describe('submission boundary', () => {
  it('accepts a Python source snapshot', () =>
    expect(runTestsSchema.safeParse(validRun).success).toBe(true));
  it.each([
    { ...validRun, language: 'javascript' },
    { ...validRun, sourceCode: 'a'.repeat(65537) },
    { ...validRun, sourceCode: '😀'.repeat(16385) },
    { ...validRun, selectionRevision: -1 },
    { ...validRun, expectedOutput: 'forged' },
    { ...validRun, sourceCode: '' },
  ])('rejects invalid or over-sized input', (input) =>
    expect(runTestsSchema.safeParse(input).success).toBe(false),
  );
  it('rejects a predictable room ID as an invite token', () =>
    expect(joinRoomSchema.safeParse({ inviteToken: validRun.problemId }).success).toBe(false));
});
describe('hidden-case privacy', () => {
  it('never serializes private stdout, stderr, IDs, or unexpected fields', () => {
    const output = publicTestResults([
      {
        id: 'visible',
        visibility: 'VISIBLE',
        passed: true,
        durationMs: 5,
        outputPreview: '[0,1]',
        errorPreview: null,
      },
      {
        id: 'secret-case-id',
        visibility: 'HIDDEN',
        passed: false,
        durationMs: 20,
        outputPreview: 'private-input-marker',
        errorPreview: 'private-trace-marker',
      },
    ]);
    expect(output.hiddenSummary).toEqual({ total: 1, passed: 0 });
    expect(output.visibleResults).toHaveLength(1);
    for (const forbidden of ['secret-case-id', 'private-input-marker', 'private-trace-marker'])
      expect(JSON.stringify(output)).not.toContain(forbidden);
  });
});
describe('execution lifecycle', () => {
  it('requires a worker claim before normal completion', () => {
    expect(canTransition('QUEUED', 'RUNNING')).toBe(true);
    expect(canTransition('QUEUED', 'PASSED')).toBe(false);
    expect(canTransition('RUNNING', 'FAILED')).toBe(true);
    expect(canTransition('QUEUED', 'ERROR')).toBe(true);
  });
  it.each(['PASSED', 'FAILED', 'ERROR'] as const)(
    'does not reopen a terminal %s result',
    (status) => expect(canTransition(status, 'RUNNING')).toBe(false),
  );
});
