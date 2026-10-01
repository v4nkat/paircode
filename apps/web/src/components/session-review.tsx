'use client';

import { useCallback, useEffect, useState } from 'react';
import { RoomShell } from './room-shell';
import { ExecutionPanel } from './execution-panel';
import { roomRequest } from './room-client';
import styles from './rooms.module.css';

type Item = {
  id: string;
  createdAt: string;
  kind: 'EVENT' | 'SNAPSHOT';
  label: string;
  sourceCode: string | null;
  problemTitle: string | null;
};
type Page = { items: Item[]; nextCursor: string | null };

const eventNames: Record<string, string> = {
  CREATED: 'Room created',
  JOINED: 'Partner joined',
  LEFT: 'Partner left',
  ENDED: 'Room ended',
  PROBLEM_CHANGED: 'Problem changed',
  EXECUTION_QUEUED: 'Tests requested',
  EXECUTION_COMPLETED: 'Test run completed',
};
export function SessionReview({ roomId }: { roomId: string }) {
  const [title, setTitle] = useState('Session review');
  const [problemId, setProblemId] = useState('');
  const [revision, setRevision] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(
    async (next?: string) => {
      setLoading(true);
      try {
        const page = await roomRequest<Page>(`/${roomId}/review${next ? `?cursor=${next}` : ''}`);
        setItems((previous) => (next ? [...previous, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setError('');
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Could not load this session.');
      } finally {
        setLoading(false);
      }
    },
    [roomId],
  );
  useEffect(() => {
    void load();
    void roomRequest<{
      room: { title: string; selectionRevision: number };
      problem: { id: string };
    }>(`/${roomId}`)
      .then((detail) => {
        setTitle(detail.room.title);
        setProblemId(detail.problem.id);
        setRevision(detail.room.selectionRevision);
      })
      .catch((failure) =>
        setError(failure instanceof Error ? failure.message : 'Could not load this room.'),
      );
  }, [load, roomId]);
  return (
    <RoomShell>
      <a href={`/rooms/${roomId}`}>← Back to room</a>
      <p className={styles.eyebrow}>SESSION REVIEW</p>
      <h1>{title}</h1>
      {error && (
        <p role="alert" className={styles.error}>
          {error} <button onClick={() => void load()}>Retry</button>
        </p>
      )}
      <section className={styles.panel} aria-label="Session timeline">
        <h2>Session timeline</h2>
        {loading && !items.length ? (
          <p role="status">Loading timeline…</p>
        ) : !items.length ? (
          <p className={styles.muted}>There are no saved events yet.</p>
        ) : (
          <ol className={styles.list}>
            {items.map((item) => (
              <li key={item.id}>
                <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
                {' · '}
                {item.kind === 'EVENT' ? (
                  <strong>{eventNames[item.label] ?? 'Room event'}</strong>
                ) : (
                  <details>
                    <summary>
                      {item.problemTitle} ·{' '}
                      {item.label === 'SESSION_END'
                        ? 'Final code'
                        : item.label === 'EXECUTION'
                          ? 'Submitted code'
                          : 'Saved draft'}
                    </summary>
                    <pre className={styles.code}>
                      <code>{item.sourceCode}</code>
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
        {cursor && (
          <button className={styles.secondary} disabled={loading} onClick={() => void load(cursor)}>
            {loading ? 'Loading…' : 'Load older activity'}
          </button>
        )}
      </section>
      {problemId && (
        <ExecutionPanel
          roomId={roomId}
          problemId={problemId}
          selectionRevision={revision}
          getSource={() => ''}
          ready={false}
          reviewOnly
        />
      )}
    </RoomShell>
  );
}
