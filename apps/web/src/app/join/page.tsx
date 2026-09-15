import { JoinRoom } from '../../components/join-room';
import { SetupMessage } from '../../components/room-shell';
import { authConfigured } from '../../server/page-access';
export const dynamic = 'force-dynamic';
export default function Page() {
  return authConfigured() ? <JoinRoom /> : <SetupMessage />;
}
