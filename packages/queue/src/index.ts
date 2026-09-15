/** BullMQ transport will be wired in Milestone 3. No code is executed by this package. */
export const executionQueueName = 'paircode-executions';
export interface ExecutionJob {
  executionId: string;
}
export const transientRetryOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: { age: 86400 },
  removeOnFail: { age: 604800 },
};
