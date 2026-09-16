'use client';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { UserButton } from '@clerk/nextjs';
import dynamic from 'next/dynamic';
import { RoomShell } from './room-shell';
import styles from './rooms.module.css';
const SharedEditor = dynamic(() => import('./shared-editor'), {
  ssr: false,
  loading: () => <p role="status">Loading editor…</p>,
});

type Summary = { id: string; title: string; status: 'ACTIVE' | 'ENDED'; createdAt: string };
type Rooms = { rooms: Summary[]; nextCursor: string | null };
type Problem = {
  id: string;
  title: string;
  promptMarkdown: string;
  starterCode: string;
  constraints: string;
};
type Detail = {
  room: Summary;
  members: { userId: string; displayName: string; role: string }[];
  problem: Problem;
  isOwner: boolean;
  savedCode: string | null;
};
type Invitation = { roomId: string; inviteToken: string; expiresAt: string };
export async function roomRequest<T>(path: string, payload?: unknown, method = 'GET'): Promise<T> {
  const response = await fetch('/api/rooms' + path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    ...(method !== 'GET'
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload ?? {}) }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error?.message ?? 'Something went wrong. Please try again.');
  return data as T;
}
function message(error: unknown) {
  return error instanceof Error ? error.message : 'Please try again.';
}
function InviteCard({ invite }: { invite: Invitation }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const link =
    typeof window === 'undefined' ? '' : `${window.location.origin}/join#${invite.inviteToken}`;
  return (
    <section className={styles.notice} aria-label="Invitation">
      <strong>One link. One partner.</strong>
      <p>This link expires in 24 hours. Anyone with it can claim the second seat.</p>
      <label htmlFor="invite-link">Invitation link</label>
      <input
        id="invite-link"
        className={styles.input}
        value={link}
        readOnly
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className={styles.actions}>
        <button
          className={styles.secondary}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setCopyError(false);
            } catch {
              setCopyError(true);
            }
          }}
        >
          {copied ? 'Copied' : 'Copy invitation'}
        </button>
        <a href={`/rooms/${invite.roomId}`}>Open room →</a>
      </div>
      <p role="status">
        {copyError
          ? 'Select the link above and copy it manually.'
          : copied
            ? 'Invitation copied.'
            : 'Keep this link somewhere private. Only its hash is stored.'}
      </p>
    </section>
  );
}
export function Dashboard() {
  const [list, setList] = useState<Rooms | null>(null);
  const [problems, setProblems] = useState<Pick<Problem, 'id' | 'title'>[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<Invitation | null>(null);
  const load = useCallback(async () => {
    try {
      const [rooms, catalog] = await Promise.all([
        roomRequest<Rooms>(''),
        roomRequest<{ problems: Pick<Problem, 'id' | 'title'>[] }>('/problems'),
      ]);
      setList(rooms);
      setProblems(catalog.problems);
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      setInvite(
        await roomRequest<Invitation>(
          '',
          { title: form.get('title'), problemId: form.get('problemId') },
          'POST',
        ),
      );
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <RoomShell>
      <div className={styles.toolbar}>
        <p className={styles.eyebrow}>YOUR PRACTICE SPACE</p>
        <UserButton />
      </div>
      <h1>Pick up where you left off.</h1>
      <p className={styles.muted}>
        A shared editor, one problem, and a partner to think out loud with.
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}{' '}
          <button
            onClick={() => {
              setError('');
              void load();
            }}
          >
            Retry
          </button>
        </p>
      )}
      {invite && <InviteCard invite={invite} />}
      <div className={styles.grid}>
        <section className={styles.panel}>
          <h2>Your rooms</h2>
          {!list ? (
            <p role="status">Loading your rooms…</p>
          ) : list.rooms.length === 0 ? (
            <>
              <p>No rooms yet.</p>
              <p className={styles.muted}>
                Start with one problem and someone you enjoy thinking out loud with.
              </p>
            </>
          ) : (
            <ul className={styles.list}>
              {list.rooms.map((room) => (
                <li key={room.id}>
                  <div className={styles.toolbar}>
                    <a href={`/rooms/${room.id}`}>{room.title}</a>
                    <span className={styles.badge}>
                      {room.status === 'ACTIVE' ? 'Open' : 'Ended'}
                    </span>
                  </div>
                  <small className={styles.muted}>
                    {new Date(room.createdAt).toLocaleDateString()}
                  </small>
                </li>
              ))}
            </ul>
          )}
          {list?.nextCursor && (
            <button
              className={styles.secondary}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const page = await roomRequest<Rooms>(`?cursor=${list.nextCursor}`);
                  setList({ rooms: [...list.rooms, ...page.rooms], nextCursor: page.nextCursor });
                } catch (e) {
                  setError(message(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Load older rooms
            </button>
          )}
        </section>
        <section className={styles.panel}>
          <h2>Start a room</h2>
          <form className={styles.form} onSubmit={create}>
            <label htmlFor="title">Room name</label>
            <input
              className={styles.input}
              id="title"
              name="title"
              placeholder="Tuesday interview practice"
              required
              maxLength={100}
            />
            <label htmlFor="problem">First problem</label>
            <select className={styles.input} id="problem" name="problemId" required>
              <option value="">Choose a problem</option>
              {problems.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <button className={styles.button} disabled={busy || !problems.length}>
              {busy ? 'Working…' : 'Create room'}
            </button>
          </form>
          {list && !problems.length && (
            <p>No practice problems are available yet. Please try again later.</p>
          )}
          <p className={styles.muted}>
            Two seats, reserved for the life of the room. Create a new room to practice with someone
            else.
          </p>
        </section>
      </div>
    </RoomShell>
  );
}
export function RoomPage({ roomId }: { roomId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<Invitation | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const load = useCallback(async () => {
    try {
      setDetail(await roomRequest<Detail>(`/${roomId}`));
    } catch (e) {
      setError(message(e));
    }
  }, [roomId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function action(kind: 'invite' | 'end') {
    setBusy(true);
    setError('');
    try {
      if (kind === 'invite')
        setInvite(await roomRequest<Invitation>(`/${roomId}/invite`, {}, 'POST'));
      else {
        await roomRequest(`/${roomId}/end`, {}, 'POST');
        setInvite(null);
        setConfirmEnd(false);
      }
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <RoomShell>
      <a href="/dashboard">← Your rooms</a>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!detail ? (
        <p role="status">{error ? 'The room could not be opened.' : 'Opening your room…'}</p>
      ) : (
        <>
          <p className={styles.eyebrow}>
            {detail.room.status === 'ACTIVE' ? 'READY FOR YOUR PARTNER' : 'SESSION ENDED'}
          </p>
          <h1>{detail.room.title}</h1>
          <div className={styles.toolbar}>
            <p>
              {detail.members.map((m) => m.displayName).join(' + ')} · {detail.members.length}/2
              seats
            </p>
            <button className={styles.secondary} onClick={() => void load()}>
              Refresh participants
            </button>
          </div>
          {invite && <InviteCard invite={invite} />}
          <div className={styles.grid}>
            <section className={styles.panel}>
              <p className={styles.eyebrow}>PYTHON · PRACTICE PROBLEM</p>
              <h2>{detail.problem.title}</h2>
              <p style={{ whiteSpace: 'pre-wrap' }}>{detail.problem.promptMarkdown}</p>
              <p className={styles.muted}>{detail.problem.constraints}</p>
              <pre className={styles.code}>
                <code>{detail.savedCode ?? detail.problem.starterCode}</code>
              </pre>
            </section>
            <aside className={styles.panel}>
              <h2>Room details</h2>
              <ul className={styles.list}>
                {detail.members.map((m) => (
                  <li key={m.userId}>
                    {m.displayName}{' '}
                    <span className={styles.badge}>{m.role === 'OWNER' ? 'Owner' : 'Partner'}</span>
                  </li>
                ))}
              </ul>
              {detail.isOwner && detail.room.status === 'ACTIVE' && (
                <>
                  <button
                    className={styles.secondary}
                    disabled={busy}
                    onClick={() => void action('invite')}
                  >
                    Generate new invitation
                  </button>
                  <p className={styles.muted}>
                    A new link replaces the old one. Existing members keep their seats.
                  </p>
                  {confirmEnd ? (
                    <div className={styles.notice}>
                      <p>
                        End this room? Check that both editors say Saved first. The saved code stays
                        available to both of you, and invitations stop working.
                      </p>
                      <div className={styles.actions}>
                        <button
                          className={styles.button}
                          disabled={busy}
                          onClick={() => void action('end')}
                        >
                          Yes, end room
                        </button>
                        <button
                          className={styles.secondary}
                          disabled={busy}
                          onClick={() => setConfirmEnd(false)}
                        >
                          Keep open
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className={styles.secondary} onClick={() => setConfirmEnd(true)}>
                      End room
                    </button>
                  )}
                </>
              )}
            </aside>
          </div>
          {detail.room.status === 'ACTIVE' && (
            <SharedEditor roomId={roomId} problemId={detail.problem.id} />
          )}
        </>
      )}
    </RoomShell>
  );
}
