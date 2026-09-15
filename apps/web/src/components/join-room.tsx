'use client';
import { useEffect, useState } from 'react';
import { SignInButton, useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { RoomShell } from './room-shell';
import { roomRequest } from './room-client';
import styles from './rooms.module.css';

export function JoinRoom() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    const valid = /^[A-Za-z0-9_-]{43}$/;
    // URL fragments never reach server access logs. Keep it only for this tab's sign-in round trip.
    try {
      if (fragment) {
        window.history.replaceState(null, '', '/join');
        if (!valid.test(fragment)) {
          sessionStorage.removeItem('paircode-invite');
          setError('This invitation is incomplete. Ask your partner for a new link.');
          return;
        }
        sessionStorage.setItem('paircode-invite', fragment);
      }
      const saved = fragment || sessionStorage.getItem('paircode-invite') || '';
      if (valid.test(saved)) setToken(saved);
      else setError('Open the invitation link your partner shared with you.');
    } catch {
      if (valid.test(fragment)) setToken(fragment);
      else setError('Open your invitation again after signing in.');
    }
  }, []);
  async function join() {
    setBusy(true);
    setError('');
    try {
      const result = await roomRequest<{ roomId: string }>('/join', { inviteToken: token }, 'POST');
      try {
        sessionStorage.removeItem('paircode-invite');
      } catch {}
      router.replace(`/rooms/${result.roomId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join. Please try again.');
      setBusy(false);
    }
  }
  return (
    <RoomShell>
      <p className={styles.eyebrow}>YOU’RE INVITED</p>
      <h1>Good problems deserve company.</h1>
      <p>
        Join your partner’s room to see the selected problem. Your seat stays reserved for the life
        of the room.
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!isLoaded ? (
        <p role="status">Checking sign-in…</p>
      ) : !isSignedIn ? (
        <SignInButton mode="modal" forceRedirectUrl="/join">
          <button className={styles.button}>Sign in to join</button>
        </SignInButton>
      ) : (
        <button className={styles.button} disabled={!token || busy} onClick={() => void join()}>
          {busy ? 'Joining…' : 'Join your partner'}
        </button>
      )}
      <p>
        <a href="/dashboard">Back to your rooms</a>
      </p>
    </RoomShell>
  );
}
