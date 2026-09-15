/** Server-only seed data. Never import this package from a client component. */
export interface ProblemDefinition {
  id: string;
  slug: string;
  version: number;
  title: string;
  promptMarkdown: string;
  language: 'python';
  starterCode: string;
  functionSignature: string;
  constraints: string;
  comparator: 'UNORDERED_INTEGER_PAIR' | 'JSON_EXACT';
  tests: {
    visibility: 'VISIBLE' | 'HIDDEN';
    input: Record<string, unknown>;
    expectedOutput: unknown;
  }[];
}

export const problems: readonly ProblemDefinition[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'two-sum',
    version: 1,
    title: 'Two Sum',
    language: 'python',
    promptMarkdown:
      'Return the indices of two distinct elements whose sum equals target. Exactly one solution exists. Either index order is accepted.',
    starterCode:
      'def two_sum(nums: list[int], target: int) -> list[int]:\n    # Return the two indices.\n    pass\n',
    functionSignature: 'two_sum(nums: list[int], target: int) -> list[int]',
    constraints: '2 <= len(nums) <= 10000; integer inputs; exactly one pair exists.',
    comparator: 'UNORDERED_INTEGER_PAIR',
    tests: [
      { visibility: 'VISIBLE', input: { nums: [2, 7, 11, 15], target: 9 }, expectedOutput: [0, 1] },
      { visibility: 'VISIBLE', input: { nums: [3, 2, 4], target: 6 }, expectedOutput: [1, 2] },
      { visibility: 'HIDDEN', input: { nums: [3, 3], target: 6 }, expectedOutput: [0, 1] },
      { visibility: 'HIDDEN', input: { nums: [-3, 4, 3, 90], target: 0 }, expectedOutput: [0, 2] },
      { visibility: 'HIDDEN', input: { nums: [0, 4, 3, 0], target: 0 }, expectedOutput: [0, 3] },
    ],
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'valid-parentheses',
    version: 1,
    title: 'Valid Parentheses',
    language: 'python',
    promptMarkdown:
      'Return whether brackets are correctly nested and closed. The input contains only ()[]{}. An empty string is valid.',
    starterCode:
      'def is_valid(s: str) -> bool:\n    # Return True for balanced brackets.\n    pass\n',
    functionSignature: 'is_valid(s: str) -> bool',
    constraints: '0 <= len(s) <= 10000; characters are ()[]{}.',
    comparator: 'JSON_EXACT',
    tests: [
      { visibility: 'VISIBLE', input: { s: '()[]{}' }, expectedOutput: true },
      { visibility: 'VISIBLE', input: { s: '(]' }, expectedOutput: false },
      { visibility: 'HIDDEN', input: { s: '' }, expectedOutput: true },
      { visibility: 'HIDDEN', input: { s: '([)]' }, expectedOutput: false },
      { visibility: 'HIDDEN', input: { s: '{[()]}' }, expectedOutput: true },
      { visibility: 'HIDDEN', input: { s: ']' }, expectedOutput: false },
    ],
  },
];
