import { auth, currentUser } from '@clerk/nextjs/server';
import { createRoomStore } from '@paircode/database/room-store';
import { createRoomService, RoomError } from '@paircode/database/rooms';
import { createRoomApi } from './room-api';
import { collaborationActions } from './collaboration';

let instance: ReturnType<typeof createRoomService> | undefined;
function service() {
  if (!process.env.DATABASE_URL)
    throw new RoomError(
      503,
      'NOT_CONFIGURED',
      'Rooms are not available yet. Please try again later.',
    );
  instance ??= createRoomService(createRoomStore(process.env.DATABASE_URL).store);
  return instance;
}
export const roomApi = createRoomApi({
  ...collaborationActions(service),
  service,
  origin: () => process.env.APP_ORIGIN,
  async authenticate() {
    if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
      throw new RoomError(
        503,
        'NOT_CONFIGURED',
        'Sign-in is not available yet. Please try again later.',
      );
    const session = await auth();
    if (!session.userId) return null;
    const user = await currentUser();
    if (!user || user.id !== session.userId) return null;
    return service().syncUser(user.id, user.firstName || user.username || 'Student');
  },
});
