import type { ReactNode } from 'react';
import styles from './rooms.module.css';

export function RoomShell({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="header wrap">
        <a href="/" className="wordmark">
          [p] PairCode
        </a>
        <nav aria-label="Room navigation">
          <a href="/dashboard">Your rooms</a>
          <a href="https://github.com/v4nkat/paircode">Source ↗</a>
        </nav>
      </header>
      <main id="main" className={styles.workspace}>
        {children}
      </main>
    </>
  );
}
export function SetupMessage() {
  return (
    <RoomShell>
      <p className={styles.eyebrow}>ROOMS · SETUP IN PROGRESS</p>
      <h1>A space for your next practice session.</h1>
      <p>
        Sign-in and room storage are being connected. The project preview is available while setup
        is completed.
      </p>
      <p>
        <a href="https://github.com/v4nkat/paircode/blob/main/docs/auth-setup.md">
          View setup guide ↗
        </a>{' '}
        · <a href="/">Back to the preview</a>
      </p>
    </RoomShell>
  );
}
