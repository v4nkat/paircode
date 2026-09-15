import { expect, it } from 'vitest';
import { problems } from '@paircode/problem-catalog';

it('includes two immutable Python problem versions with visible and hidden cases', () => {
  expect(problems).toHaveLength(2);
  for (const problem of problems) {
    expect(problem.version).toBe(1);
    expect(problem.language).toBe('python');
    expect(problem.tests.some((test) => test.visibility === 'VISIBLE')).toBe(true);
    expect(problem.tests.some((test) => test.visibility === 'HIDDEN')).toBe(true);
    expect(problem.starterCode).toContain('def ');
  }
});
