import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { judge0, matches, pythonProgram, SandboxError } from '../../apps/worker/src/sandbox.js';

const config = {
  url: 'https://sandbox.example/',
  token: 'test-only-key',
  languageId: 71,
  cpuSeconds: 2,
  wallSeconds: 10,
  memoryKb: 131072,
};
const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');
describe('isolated Judge0 adapter', () => {
  it('sends only the program and test input with bounded resources and no expected answer', async () => {
    const token = randomUUID();
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ token }, { status: 201 }));
    const sandbox = judge0({ ...config, fetch: transport });
    expect(
      await sandbox.submit('def two_sum(nums, target): return [1, 0]', 'two-sum', {
        nums: [2, 7],
        target: 9,
      }),
    ).toBe(token);
    const [url, request] = transport.mock.calls[0]!;
    expect(String(url)).toBe('https://sandbox.example/submissions?base64_encoded=true&wait=false');
    expect(request?.redirect).toBe('error');
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      enable_network: false,
      max_processes_and_or_threads: 1,
      max_file_size: 64,
      cpu_time_limit: 2,
      wall_time_limit: 10,
      memory_limit: 131072,
    });
    expect(body).not.toHaveProperty('expected_output');
    expect(body).not.toHaveProperty('callback_url');
    expect(Buffer.from(body.source_code, 'base64').toString()).not.toContain(config.token);
    expect(JSON.parse(Buffer.from(body.stdin, 'base64').toString())).toEqual({
      nums: [2, 7],
      target: 9,
    });
  });
  it.each([
    [5, 'TIMEOUT'],
    [6, 'COMPILE_ERROR'],
    [9, 'RUNTIME_ERROR'],
    [4, 'WRONG_ANSWER'],
  ] as const)('maps sandbox status %i without guessing memory exhaustion', async (id, failure) => {
    const sandbox = judge0({
      ...config,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ status: { id }, time: '0.125', memory: 4096 })),
    });
    expect(await sandbox.poll(randomUUID())).toMatchObject({
      finished: true,
      failure,
      durationMs: 125,
      memoryKb: 4096,
    });
  });
  it('decodes a result envelope and strips terminal control codes from previews', async () => {
    const sandbox = judge0({
      ...config,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          status: { id: 3 },
          stdout: encoded({ kind: 'result', value: true, output: '\u001b[31mhello\u0000' }),
        }),
      ),
    });
    expect(await sandbox.poll(randomUUID())).toMatchObject({
      value: true,
      output: 'hello',
      failure: null,
    });
  });
  it.each(['compile_error', 'runtime_error'])(
    'recognizes the Python wrapper %s response',
    async (kind) => {
      const sandbox = judge0({
        ...config,
        fetch: vi.fn<typeof fetch>().mockResolvedValue(
          Response.json({
            status: { id: 3 },
            stdout: encoded({ kind, error: 'safe diagnostic' }),
          }),
        ),
      });
      expect((await sandbox.poll(randomUUID())).failure).toBe(
        kind === 'compile_error' ? 'COMPILE_ERROR' : 'RUNTIME_ERROR',
      );
    },
  );
  it.each([
    [429, true],
    [503, true],
    [401, false],
    [422, false],
  ] as const)('classifies HTTP %i retry eligibility', async (status, transient) => {
    const sandbox = judge0({
      ...config,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('private-server-error', { status })),
    });
    await expect(sandbox.poll(randomUUID())).rejects.toMatchObject({
      transient,
      message: 'Sandbox request failed',
    });
  });
  it('rejects oversized or malformed responses rather than retaining unlimited output', async () => {
    const sandbox = judge0({
      ...config,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(131073))),
    });
    await expect(sandbox.poll(randomUUID())).rejects.toBeInstanceOf(SandboxError);
    expect(() => pythonProgram('pass', 'client-chosen-function')).toThrow(SandboxError);
    expect(() => judge0({ ...config, cpuSeconds: 100 })).toThrow(SandboxError);
  });
});
describe('server-side result comparison', () => {
  it('accepts either integer index order but rejects repeated, fractional, or extra indices', () => {
    expect(matches([1, 0], [0, 1], 'UNORDERED_INTEGER_PAIR')).toBe(true);
    for (const value of [
      [0, 0],
      [0, 1, 2],
      [0, 1.5],
      ['0', '1'],
    ])
      expect(matches(value, [0, 1], 'UNORDERED_INTEGER_PAIR')).toBe(false);
  });
  it('keeps JSON booleans distinct from numbers and compares object values independently of key order', () => {
    expect(matches(true, 1, 'JSON_EXACT')).toBe(false);
    expect(matches({ a: 1, b: 2 }, { b: 2, a: 1 }, 'JSON_EXACT')).toBe(true);
  });
});
