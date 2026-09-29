import { createRoomStore } from '@paircode/database/room-store';
import { executionService, executionRepository } from '@paircode/database/executions';
import { RoomError } from '@paircode/database/rooms';
import { executionQueue } from '@paircode/queue/transport';

let database: ReturnType<typeof createRoomStore> | undefined;
let queue: ReturnType<typeof executionQueue> | undefined;
function store() {
  if (!process.env.DATABASE_URL)
    throw new RoomError(503, 'NOT_CONFIGURED', 'Execution history is not configured yet.');
  database ??= createRoomStore(process.env.DATABASE_URL);
  return database.store;
}
export const executionActions = {
  executions() {
    const service = executionService(store());
    return {
      ...service,
      submit: async (...args: Parameters<typeof service.submit>) => {
        if (process.env.EXECUTION_ENABLED !== 'true' || !process.env.REDIS_URL)
          throw new RoomError(503, 'NOT_CONFIGURED', 'Python execution is not configured yet.');
        return service.submit(...args);
      },
    };
  },
  async dispatchExecution(id: string) {
    if (!process.env.REDIS_URL) throw new Error('Redis unavailable');
    queue ??= executionQueue(process.env.REDIS_URL);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        queue.dispatch(id).then(() => executionRepository(store()).dispatched(id)),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Queue dispatch timed out')), 3000);
        }),
      ]);
    } finally {
      clearTimeout(deadline);
    }
  },
};
