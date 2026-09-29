import { parseEnvironment, workerEnvSchema } from '@paircode/config';
import { createRoomStore } from '../../../packages/database/src/room-store.js';
import { executionRepository } from '../../../packages/database/src/executions.js';
import { executionQueue, executionWorker } from '@paircode/queue/transport';
import { judge0 } from './sandbox.js';
import { executionProcessor } from './process-execution.js';

const env = parseEnvironment(workerEnvSchema, process.env);
const database = createRoomStore(env.DATABASE_URL);
const repository = executionRepository(database.store);
const queue = executionQueue(env.REDIS_URL);
const sandbox = judge0({
  url: env.SANDBOX_API_URL,
  token: env.SANDBOX_AUTH_TOKEN,
  languageId: env.SANDBOX_PYTHON_LANGUAGE_ID,
  cpuSeconds: env.SANDBOX_CPU_SECONDS,
  wallSeconds: env.SANDBOX_WALL_SECONDS,
  memoryKb: env.SANDBOX_MEMORY_KB,
});
const worker = executionWorker(env.REDIS_URL, executionProcessor(repository, sandbox));
let recovering = false,
  stopping = false;
async function recover() {
  if (recovering || stopping) return;
  recovering = true;
  try {
    for (const run of await repository.pending()) {
      if (stopping) break;
      await queue.dispatch(run.id);
      await repository.dispatched(run.id);
    }
  } catch {
    console.error(JSON.stringify({ service: 'worker', event: 'dispatch_recovery_failed' }));
  } finally {
    recovering = false;
  }
}
const timer = setInterval(() => void recover(), 5000);
void recover();
async function close() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  const deadline = setTimeout(() => process.exit(1), 30000);
  deadline.unref();
  try {
    await worker.close();
    await queue.close();
    await database.close();
    clearTimeout(deadline);
  } catch {
    process.exitCode = 1;
  }
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void close());
console.log(JSON.stringify({ service: 'worker', event: 'started' }));
