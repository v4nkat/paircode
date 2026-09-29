import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { executionQueueName, transientRetryOptions } from '@paircode/queue';
import type { ExecutionJob } from './index.js';
const report = () =>
  console.error(JSON.stringify({ service: 'queue', event: 'redis_unavailable' }));
export function executionQueue(url: string, name = executionQueueName) {
  const connection = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    commandTimeout: 5000,
    enableOfflineQueue: false,
  });
  connection.on('error', report);
  const queue = new Queue<ExecutionJob>(name, {
    connection,
    defaultJobOptions: transientRetryOptions,
  });
  queue.on('error', report);
  return {
    async dispatch(id: string) {
      const previous = await queue.getJob(id);
      if (previous) {
        const state = await previous.getState();
        if (state === 'failed' || state === 'completed') await previous.remove();
        else return;
      }
      await queue.add('execute', { executionId: id }, { jobId: id });
    },
    async close() {
      await queue.close();
      connection.disconnect();
    },
  };
}
export function executionWorker(
  url: string,
  process: (id: string) => Promise<void>,
  name = executionQueueName,
) {
  const connection = new Redis(url, { maxRetriesPerRequest: null, connectTimeout: 5000 });
  connection.on('error', report);
  const worker = new Worker<ExecutionJob>(
    name,
    async (job) => {
      if (job.name !== 'execute' || !/^[0-9a-f-]{36}$/i.test(job.data.executionId))
        throw new Error('Invalid execution job');
      await process(job.data.executionId);
    },
    { connection, concurrency: 2, maxStalledCount: 2, maxStartedAttempts: 6 },
  );
  worker.on('error', report);
  worker.on('failed', (job) =>
    console.error(JSON.stringify({ service: 'worker', event: 'job_failed', jobId: job?.id })),
  );
  return {
    async close() {
      await worker.close();
      connection.disconnect();
    },
  };
}
