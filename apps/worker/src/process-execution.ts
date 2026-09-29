import { setTimeout as pause } from 'node:timers/promises';
import type {
  CaseResult,
  ExecutionRepository,
  Failure,
} from '../../../packages/database/src/executions.js';
import { matches, SandboxError } from './sandbox.js';
import type { Sandbox } from './sandbox.js';

export function executionProcessor(
  repository: ExecutionRepository,
  sandbox: Sandbox,
  sleep: (ms: number) => Promise<unknown> = pause,
) {
  return async (id: string) => {
    const run = await repository.claim(id);
    if (!run) return;
    const started = Date.now();
    const log = (status: string, errorCategory: Failure | null = null) =>
      console.log(
        JSON.stringify({
          service: 'worker',
          roomId: run.roomId,
          executionId: id,
          jobId: id,
          userId: run.requestedById,
          status,
          durationMs: Date.now() - started,
          errorCategory,
        }),
      );
    log('RUNNING');
    let renewed = Date.now();
    const lease = async () => {
      if (Date.now() - renewed < 20000) return;
      if (!(await repository.renew(id, run.lease))) throw new Error('Lease lost');
      renewed = Date.now();
    };
    try {
      if (!run.tests.length || run.tests.length > 20) throw new SandboxError(false);
      const results: CaseResult[] = [];
      let failure: Failure | null = null;
      for (const test of run.tests) {
        await lease();
        // Known tokens survive retries; polling failures must not resubmit the program.
        const token =
          test.sandboxToken ?? (await sandbox.submit(run.sourceCode, run.slug, test.input));
        if (!test.sandboxToken) await repository.token(id, run.lease, test.id, token);
        const deadline = Date.now() + 45000;
        let outcome;
        do {
          await lease();
          outcome = await sandbox.poll(token);
          if (outcome.finished) break;
          if (Date.now() >= deadline || Date.now() - started > 300000) throw new SandboxError(true);
          await sleep(500);
        } while (true);
        const category =
          outcome.failure ??
          (matches(outcome.value, test.expectedOutput, run.comparator) ? null : 'WRONG_ANSWER');
        failure ??= category;
        results.push({
          testCaseId: test.id,
          passed: category === null,
          durationMs: outcome.durationMs,
          memoryKb: outcome.memoryKb,
          outputPreview: test.visibility === 'VISIBLE' ? outcome.output : null,
          errorPreview: test.visibility === 'VISIBLE' ? outcome.error : null,
        });
      }
      await repository.finish(id, run.lease, results, failure);
      log(failure ? 'FAILED' : 'PASSED', failure);
    } catch (error) {
      const category = error instanceof SandboxError ? 'SANDBOX_UNAVAILABLE' : 'WORKER_FAILURE';
      const retry = run.attempt < 3 && (!(error instanceof SandboxError) || error.transient);
      await repository.failed(id, run.lease, retry, category);
      log(retry ? 'RETRY_PENDING' : 'ERROR', category);
      if (retry) throw new Error('Execution infrastructure temporarily unavailable');
    }
  };
}
