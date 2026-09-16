import { SignUp } from '@clerk/nextjs';
import { SetupMessage, RoomShell } from '../../../components/room-shell';
import { authConfigured } from '../../../server/page-access';
export const dynamic = 'force-dynamic';
export default function Page() {
  return authConfigured() ? (
    <RoomShell>
      <SignUp
        path="/sign-up"
        routing="path"
        signInUrl="/sign-in"
        fallbackRedirectUrl="/dashboard"
      />
    </RoomShell>
  ) : (
    <SetupMessage />
  );
}
