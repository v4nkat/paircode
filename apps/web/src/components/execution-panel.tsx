'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './rooms.module.css';

type Attempt = {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'ERROR';
  errorCategory: string | null;
  queuedAt: string;
  durationMs: number | null;
};
type Result = {
  execution: Attempt;
  snapshot: { sourceCode: string; language: string; title: string };
  visibleResults: {
    id: string;
    passed: boolean | null;
    durationMs: number | null;
    outputPreview: string | null;
    errorPreview: string | null;
  }[];
  hiddenSummary: { total: number; passed: number };
};
const labels: Record<string, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  PASSED: 'All tests passed',
  FAILED: 'Tests failed',
  ERROR: 'Could not complete',
  WRONG_ANSWER: 'Incorrect answer',
  TIMEOUT: 'Timed out',
  COMPILE_ERROR: 'Syntax or compilation error',
  RUNTIME_ERROR: 'Runtime error',
  SANDBOX_UNAVAILABLE: 'Sandbox unavailable',
  QUEUE_FAILURE: 'Queue unavailable',
  WORKER_FAILURE: 'Worker interrupted',
};

export function ExecutionPanel({
  roomId,
  problemId,
  selectionRevision,
  getSource,
  ready,
  reviewOnly = false,
}: {
  roomId: string;
  problemId: string;
  selectionRevision: number;
  getSource: () => string;
  ready: boolean;
  reviewOnly?: boolean;
}) {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadedOlder = useRef(false);
  const pending = useRef<{ key: string; source: string } | null>(null);
  const load = useCallback(
    async (path: string) => {
      const response = await fetch(`/api/rooms/${roomId}/executions${path}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message || 'Results are temporarily unavailable.');
      return data;
    },
    [roomId],
  );
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const data = (await load('')) as { executions: Attempt[]; nextCursor: string | null };
        if (!disposed) {
          setAttempts((previous) => {
            const merged = new Map(previous.map((attempt) => [attempt.id, attempt]));
            for (const attempt of data.executions) merged.set(attempt.id, attempt);
            return [...merged.values()].sort(
              (a, b) => b.queuedAt.localeCompare(a.queuedAt) || b.id.localeCompare(a.id),
            );
          });
          if (!loadedOlder.current) setNextCursor(data.nextCursor);
        }
        if (selected) {
          const detail = (await load(`/${selected}`)) as Result;
          if (!disposed) setResult(detail);
        }
        if (!disposed) setPollError('');
      } catch (failure) {
        if (!disposed)
          setPollError(failure instanceof Error ? failure.message : 'Results are unavailable.');
      } finally {
        if (!disposed) timer = setTimeout(() => void refresh(), 2000);
      }
    }
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [load, selected]);
  async function run() {
    if (busy || !ready) return;
    setBusy(true);
    setError('');
    pending.current ??= { key: crypto.randomUUID(), source: getSource() };
    try {
      const response = await fetch(`/api/rooms/${roomId}/executions`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.current.key },
        body: JSON.stringify({
          sourceCode: pending.current.source,
          language: 'python',
          problemId,
          selectionRevision,
        }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status < 500) pending.current = null;
        throw new Error(data.error?.message || 'Could not submit this run.');
      }
      setSelected(data.id);
      setResult(null);
      pending.current = null;
      setRetry(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not submit this run.');
      setRetry(pending.current !== null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={styles.panel}
      style={{ marginTop: '1.5rem' }}
      aria-label="Python test execution"
    >
      <div className={styles.toolbar}>
        <h2>{reviewOnly ? 'Session attempts' : 'Test your solution'}</h2>
        {!reviewOnly && (
          <button className={styles.button} disabled={!ready || busy} onClick={() => void run()}>
            {busy ? 'Submitting…' : retry ? 'Retry same submission' : 'Run Tests'}
          </button>
        )}
      </div>
      <p className={styles.muted}>
        {reviewOnly
          ? 'Review the exact code submitted for each attempt. Newest attempts appear first.'
          : 'Each run saves this version of your code. You can keep editing while it runs.'}
      </p>
      {(error || pollError) && (
        <p role="alert" className={styles.error}>
          {error || pollError}
        </p>
      )}
      {result && (
        <div aria-live="polite">
          <h3>
            {labels[result.execution.errorCategory ?? result.execution.status] ?? 'Execution error'}
          </h3>
          <p>{result.snapshot.title} · Python</p>
          <details>
            <summary>Code submitted for this attempt</summary>
            <pre className={styles.code}>
              <code>{result.snapshot.sourceCode}</code>
            </pre>
          </details>
          {['QUEUED', 'RUNNING'].includes(result.execution.status) ? (
            <p>Waiting for the isolated Python runner…</p>
          ) : (
            <>
              {result.visibleResults.map((test, index) => (
                <div key={test.id}>
                  <strong>
                    Example {index + 1}: {test.passed ? 'Passed' : 'Failed'}
                  </strong>
                  {test.durationMs !== null && <span> · {test.durationMs} ms</span>}
                  {test.outputPreview && <pre className={styles.code}>{test.outputPreview}</pre>}
                  {test.errorPreview && <pre className={styles.code}>{test.errorPreview}</pre>}
                </div>
              ))}
              {result.hiddenSummary.total > 0 && (
                <p>
                  Hidden tests: {result.hiddenSummary.passed} of {result.hiddenSummary.total}{' '}
                  passed.
                </p>
              )}
            </>
          )}
        </div>
      )}
      <h3>Attempt history</h3>
      {!attempts.length ? (
        <p className={styles.muted}>
          {reviewOnly
            ? 'No tests were run in this session.'
            : 'No runs yet. Start with the example inputs.'}
        </p>
      ) : (
        <ul className={styles.list}>
          {attempts.map((attempt) => (
            <li key={attempt.id}>
              <button
                className={styles.secondary}
                onClick={() => {
                  setSelected(attempt.id);
                  setResult(null);
                }}
              >
                {labels[attempt.status]} · {new Date(attempt.queuedAt).toLocaleTimeString()}
              </button>
            </li>
          ))}
        </ul>
      )}
      {nextCursor && (
        <button
          className={styles.secondary}
          disabled={loadingOlder}
          onClick={async () => {
            setLoadingOlder(true);
            try {
              const page = (await load(`?cursor=${nextCursor}`)) as {
                executions: Attempt[];
                nextCursor: string | null;
              };
              loadedOlder.current = true;
              setAttempts((previous) => [
                ...new Map(
                  [...previous, ...page.executions].map((attempt) => [attempt.id, attempt]),
                ).values(),
              ]);
              setNextCursor(page.nextCursor);
            } catch (failure) {
              setError(
                failure instanceof Error ? failure.message : 'Could not load older attempts.',
              );
            } finally {
              setLoadingOlder(false);
            }
          }}
        >
          {loadingOlder ? 'Loading…' : 'Load older attempts'}
        </button>
      )}
    </section>
  );
}
