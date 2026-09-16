import { Dashboard } from '../../components/room-client';
import { SetupMessage } from '../../components/room-shell';
import { pageAccess } from '../../server/page-access';
export const dynamic = 'force-dynamic';
export default async function Page() {
  return (await pageAccess()) ? <Dashboard /> : <SetupMessage />;
}
