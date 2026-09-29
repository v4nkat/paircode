import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { executionQueue, executionWorker } from '../../packages/queue/src/transport.js';

describe.skipIf(!process.env.TEST_REDIS_URL)('real Redis delivery', () => {
  it('deduplicates waiting jobs, retries transient failures, and survives worker restart', async () => {
    const url = process.env.TEST_REDIS_URL!;
    const name = `paircode-test-${randomUUID()}`;
    const queue = executionQueue(url, name);
    let worker: ReturnType<typeof executionWorker> | undefined;
    const first = randomUUID(),
      second = randomUUID();
    const calls: string[] = [];
    const dispatch = async (id: string) => {
      await expect
        .poll(
          async () => {
            try {
              await queue.dispatch(id);
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 10000 },
        )
        .toBe(true);
    };
    try {
      await dispatch(first);
      await dispatch(first);
      worker = executionWorker(
        url,
        async (id) => {
          calls.push(id);
          if (calls.length === 1) throw new Error('Simulated transient failure');
        },
        name,
      );
      await expect.poll(() => calls.length, { timeout: 10000 }).toBe(2);
      expect(calls).toEqual([first, first]);
      await worker.close();
      worker = undefined;
      await dispatch(second);
      worker = executionWorker(
        url,
        async (id) => {
          calls.push(id);
        },
        name,
      );
      await expect.poll(() => calls.length, { timeout: 10000 }).toBe(3);
      expect(calls[2]).toBe(second);
    } finally {
      await worker?.close();
      await queue.close();
    }
  });
});
