import { isDeepStrictEqual } from 'node:util';

export type CodeFailure = 'WRONG_ANSWER' | 'TIMEOUT' | 'COMPILE_ERROR' | 'RUNTIME_ERROR';
export interface Outcome {
  finished: boolean;
  failure: CodeFailure | null;
  value: unknown;
  output: string;
  error: string;
  durationMs: number | null;
  memoryKb: number | null;
}
export class SandboxError extends Error {
  readonly transient: boolean;
  constructor(transient: boolean) {
    super('Sandbox request failed');
    this.transient = transient;
  }
}
export interface Sandbox {
  submit(source: string, slug: string, input: unknown): Promise<string>;
  poll(token: string): Promise<Outcome>;
}

// This string is sent to the isolated sandbox. The application never runs Python.
export function pythonProgram(source: string, slug: string): string {
  const name = slug === 'two-sum' ? 'two_sum' : slug === 'valid-parentheses' ? 'is_valid' : null;
  if (!name) throw new SandboxError(false);
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return `import base64, contextlib, io, json, sys, traceback
class LimitedOutput(io.StringIO):
    def write(self, value):
        remaining = max(0, 8192 - self.tell())
        super().write(value[:remaining])
        return len(value)
payload = json.loads(sys.stdin.read())
scope = {"__name__": "solution"}
output = LimitedOutput()
try:
    compiled = compile(base64.b64decode("${encoded}").decode("utf-8"), "solution.py", "exec")
except SyntaxError:
    print(json.dumps({"kind": "compile_error", "error": traceback.format_exc()[-2048:]}))
    sys.exit(0)
try:
    with contextlib.redirect_stdout(output):
        exec(compiled, scope)
        value = scope["${name}"](**payload)
    print(json.dumps({"kind": "result", "value": value, "output": output.getvalue()}, allow_nan=False))
except Exception:
    print(json.dumps({"kind": "runtime_error", "error": traceback.format_exc()[-2048:], "output": output.getvalue()}))
`;
}

export function matches(actual: unknown, expected: unknown, comparator: string): boolean {
  if (comparator === 'JSON_EXACT') return isDeepStrictEqual(actual, expected);
  if (comparator !== 'UNORDERED_INTEGER_PAIR') throw new SandboxError(false);
  return (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length === 2 &&
    expected.length === 2 &&
    actual.every(Number.isSafeInteger) &&
    actual[0] !== actual[1] &&
    isDeepStrictEqual(
      [...actual].sort((a, b) => a - b),
      [...expected].sort((a, b) => a - b),
    )
  );
}
export const preview = (value: string, max: number) =>
  value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, max);

export function judge0(options: {
  url: string;
  token: string;
  languageId: number;
  cpuSeconds: number;
  wallSeconds: number;
  memoryKb: number;
  fetch?: typeof fetch;
}): Sandbox {
  const base = new URL(options.url);
  if (
    !['https:', 'http:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !options.token ||
    !Number.isInteger(options.languageId) ||
    options.languageId <= 0 ||
    !(options.cpuSeconds > 0 && options.cpuSeconds <= 5) ||
    !(options.wallSeconds >= options.cpuSeconds && options.wallSeconds <= 30) ||
    !Number.isInteger(options.memoryKb) ||
    options.memoryKb < 1024 ||
    options.memoryKb > 262144
  )
    throw new SandboxError(false);
  base.pathname = base.pathname.replace(/\/$/, '') + '/';
  const transport = options.fetch ?? fetch;
  async function request(path: string, body?: unknown): Promise<Record<string, unknown>> {
    try {
      const response = await transport(new URL(path, base), {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        headers: { 'X-Auth-Token': options.token, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new SandboxError(response.status === 429 || response.status >= 500);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new SandboxError(true);
      let size = 0;
      const parts: Uint8Array[] = [];
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 131072) {
            await reader.cancel();
            throw new SandboxError(false);
          }
          parts.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      const data: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SandboxError(false);
      return data as Record<string, unknown>;
    } catch (error) {
      if (error instanceof SandboxError) throw error;
      throw new SandboxError(!(error instanceof SyntaxError));
    }
  }
  function decoded(value: unknown): string {
    if (value == null) return '';
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
      throw new SandboxError(false);
    return Buffer.from(value, 'base64').toString('utf8');
  }
  return {
    async submit(source, slug, input) {
      const data = await request('submissions?base64_encoded=true&wait=false', {
        source_code: Buffer.from(pythonProgram(source, slug)).toString('base64'),
        stdin: Buffer.from(JSON.stringify(input)).toString('base64'),
        language_id: options.languageId,
        cpu_time_limit: options.cpuSeconds,
        wall_time_limit: options.wallSeconds,
        memory_limit: options.memoryKb,
        max_processes_and_or_threads: 1,
        max_file_size: 64,
        enable_network: false,
        enable_per_process_and_thread_time_limit: false,
        enable_per_process_and_thread_memory_limit: false,
        number_of_runs: 1,
        redirect_stderr_to_stdout: false,
      });
      if (typeof data.token !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.token))
        throw new SandboxError(true);
      return data.token;
    },
    async poll(token) {
      if (!/^[0-9a-f-]{36}$/i.test(token)) throw new SandboxError(false);
      const data = await request(
        `submissions/${token}?base64_encoded=true&fields=status,stdout,stderr,compile_output,time,memory`,
      );
      const status = (data.status as { id?: unknown } | undefined)?.id;
      if (typeof status !== 'number' || !Number.isInteger(status) || status < 1 || status > 14)
        throw new SandboxError(false);
      if (status === 13 || status === 14) throw new SandboxError(true);
      const result: Outcome = {
        finished: status > 2,
        failure: null,
        value: null,
        output: '',
        error: '',
        durationMs: null,
        memoryKb: null,
      };
      if (
        data.time !== null &&
        data.time !== undefined &&
        Number.isFinite(Number(data.time)) &&
        Number(data.time) >= 0
      )
        result.durationMs = Math.min(2147483647, Math.round(Number(data.time) * 1000));
      if (typeof data.memory === 'number' && Number.isFinite(data.memory) && data.memory >= 0)
        result.memoryKb = Math.min(2147483647, Math.round(data.memory));
      if (!result.finished) return result;
      if (status !== 3) {
        result.failure =
          status === 5
            ? 'TIMEOUT'
            : status === 6
              ? 'COMPILE_ERROR'
              : status === 4
                ? 'WRONG_ANSWER'
                : 'RUNTIME_ERROR';
        result.error = preview(decoded(data.compile_output) || decoded(data.stderr), 2048);
        return result;
      }
      try {
        const payload = JSON.parse(decoded(data.stdout)) as {
          kind?: string;
          value?: unknown;
          output?: unknown;
          error?: unknown;
        };
        if (!payload || !['result', 'compile_error', 'runtime_error'].includes(payload.kind ?? ''))
          throw new Error();
        result.failure =
          payload.kind === 'compile_error'
            ? 'COMPILE_ERROR'
            : payload.kind === 'runtime_error'
              ? 'RUNTIME_ERROR'
              : null;
        result.value = payload.value;
        result.output = preview(typeof payload.output === 'string' ? payload.output : '', 8192);
        result.error = preview(typeof payload.error === 'string' ? payload.error : '', 2048);
      } catch {
        result.failure = 'RUNTIME_ERROR';
        result.error = 'The program did not return a valid result.';
      }
      return result;
    },
  };
}
