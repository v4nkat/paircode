import { notFound } from 'next/navigation';
import { roomIdSchema } from '@paircode/contracts';
import { RoomPage } from '../../../components/room-client';
import { SetupMessage } from '../../../components/room-shell';
import { pageAccess } from '../../../server/page-access';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  if (!roomIdSchema.safeParse(roomId).success) notFound();
  return (await pageAccess()) ? <RoomPage roomId={roomId} /> : <SetupMessage />;
}
