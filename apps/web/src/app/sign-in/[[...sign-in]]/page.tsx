import { SignIn } from '@clerk/nextjs';
import { SetupMessage, RoomShell } from '../../../components/room-shell';
import { authConfigured } from '../../../server/page-access';
export const dynamic = 'force-dynamic';
export default function Page() {
  return authConfigured() ? (
    <RoomShell>
      <SignIn
        path="/sign-in"
        routing="path"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/dashboard"
      />
    </RoomShell>
  ) : (
    <SetupMessage />
  );
}
