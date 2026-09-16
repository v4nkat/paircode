'use client';

import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import { readVarString } from 'lib0/decoding';
import type { CollaborationIdentity } from '@paircode/contracts';
import styles from './shared-editor.module.css';

type Ticket = { ticket: string; url: string; identity: CollaborationIdentity };
type Person = { clientId: number; name: string; color: string };
const digest = async (source: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');

export default function SharedEditor({ roomId, problemId }: { roomId: string; problemId: string }) {
  const container = useRef<HTMLDivElement>(null);
  const retry = useRef<() => void>(() => {});
  const exportCode = useRef<() => void>(() => {});
  const [connection, setConnection] = useState('Connecting…');
  const [save, setSave] = useState('Waiting for document');
  const [error, setError] = useState('');
  const [people, setPeople] = useState<Person[]>([]);

  useEffect(() => {
    if (!container.current) return;
    let disposed = false,
      initialized = false,
      permanent = false,
      connecting = false;
    let attempts = 0,
      savedHash = '',
      revision = 0,
      cleanSource = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let provider: WebsocketProvider | undefined;
    let binding: MonacoBinding | undefined;
    const workers: Worker[] = [];
    // Same-origin workers keep the editor usable without a third-party CDN.
    (
      globalThis as typeof globalThis & { MonacoEnvironment: monaco.Environment }
    ).MonacoEnvironment = {
      getWorker() {
        const worker = new Worker(new URL('./editor.worker.ts', import.meta.url), {
          type: 'module',
        });
        workers.push(worker);
        return worker;
      },
    };
    const doc = new Y.Doc();
    const text = doc.getText(problemId);
    const model = monaco.editor.createModel('', 'python');
    const editor = monaco.editor.create(container.current, {
      model,
      theme: 'vs-dark',
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      lineHeight: 23,
      scrollBeyondLastLine: false,
      tabSize: 4,
      insertSpaces: true,
      padding: { top: 18, bottom: 18 },
      ariaLabel: 'Shared Python editor',
    });
    function updateSaved() {
      const current = ++revision;
      if (!initialized) return;
      if (!provider?.wsconnected) {
        setSave('Changes stay in this tab until reconnected');
        return;
      }
      setSave('Saving…');
      const source = text.toString();
      void digest(source).then((hash) => {
        if (!disposed && current === revision && hash === savedHash) {
          cleanSource = source;
          setSave('Saved');
        }
      });
    }
    text.observe(updateSaved);
    function schedule() {
      if (disposed || permanent || timer) return;
      timer = setTimeout(
        () => {
          timer = undefined;
          void connect();
        },
        Math.min(15000, 500 * 2 ** Math.min(attempts++, 5)),
      );
    }
    async function connect() {
      if (disposed || connecting || permanent || provider?.wsconnected) return;
      connecting = true;
      setConnection(initialized ? 'Reconnecting…' : 'Connecting…');
      try {
        const response = await fetch(`/api/rooms/${roomId}/collaboration-ticket`, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: doc.clientID }),
          signal: AbortSignal.timeout(10000),
        });
        const data = await response.json();
        if (disposed) return;
        if (!response.ok) {
          permanent = [401, 403, 404, 409].includes(response.status);
          throw new Error(data.error?.message || 'The editor could not connect.');
        }
        const ticket = data as Ticket;
        if (!provider) {
          provider = new WebsocketProvider(ticket.url, roomId, doc, {
            connect: false,
            disableBc: true,
            shouldReconnect: () => false,
          });
          binding = new MonacoBinding(text, model, new Set([editor]), provider.awareness);
          provider.messageHandlers[4] = (_encoder, decoder) => {
            try {
              const ack = JSON.parse(readVarString(decoder)) as { hashes?: Record<string, string> };
              savedHash = ack.hashes?.[problemId] ?? '';
              updateSaved();
            } catch {
              setSave('Save confirmation unavailable');
            }
          };
          provider.on('sync', (synced: boolean) => {
            if (!synced || disposed) return;
            initialized = true;
            attempts = 0;
            setConnection('Live');
            setError('');
            editor.updateOptions({ readOnly: false });
            updateSaved();
          });
          provider.on('closed', (event: { code: number }) => {
            if (disposed) return;
            permanent = event.code >= 4400 && event.code < 4500;
            setConnection(permanent ? 'Connection closed' : 'Offline');
            if (permanent) {
              editor.updateOptions({ readOnly: true });
              setError(
                event.code === 4403
                  ? 'This room is closed or your access changed. You can download the code from this tab.'
                  : 'The server rejected an update. Download your code before reloading.',
              );
            }
            updateSaved();
            schedule();
          });
          provider.awareness.on('change', () => {
            if (disposed || !provider) return;
            const present: Person[] = [];
            for (const [clientId, state] of provider.awareness.getStates()) {
              const user = state.user;
              if (
                user &&
                typeof user.name === 'string' &&
                ['#26724b', '#865cb5'].includes(user.color)
              )
                present.push({ clientId, name: user.name.slice(0, 100), color: user.color });
            }
            setPeople(present);
          });
        }
        provider.params = { ticket: ticket.ticket };
        provider.awareness.setLocalStateField('user', {
          name: ticket.identity.displayName,
          color: ticket.identity.color,
        });
        provider.connect();
      } catch (failure) {
        if (disposed) return;
        setError(failure instanceof Error ? failure.message : 'The editor could not connect.');
        setConnection('Offline');
        schedule();
      } finally {
        connecting = false;
      }
    }
    retry.current = () => {
      if (!permanent) {
        if (timer) clearTimeout(timer);
        timer = undefined;
        void connect();
      }
    };
    exportCode.current = () => {
      const url = URL.createObjectURL(new Blob([text.toString()], { type: 'text/x-python' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'paircode-draft.py';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const warn = (event: BeforeUnloadEvent) => {
      if (initialized && text.toString() !== cleanSource) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    window.addEventListener('online', retry.current);
    void connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('online', retry.current);
      binding?.destroy();
      provider?.destroy();
      editor.dispose();
      model.dispose();
      doc.destroy();
      workers.forEach((worker) => worker.terminate());
    };
  }, [roomId, problemId]);

  return (
    <section className={styles.shell} aria-label="Collaborative editor">
      <div className={styles.toolbar}>
        <strong>solution.py</strong>
        <span role="status">
          {connection} · {save}
        </span>
      </div>
      <div className={styles.presence} aria-label="Online participants">
        {people.length
          ? people.map((p) => (
              <span key={p.clientId}>
                <i style={{ background: p.color }} />
                {p.name}
              </span>
            ))
          : 'Waiting for a connection'}
      </div>
      {people.map((p) => (
        <style
          key={p.clientId}
        >{`.yRemoteSelection-${p.clientId}{background:${p.color}33}.yRemoteSelectionHead-${p.clientId}{border-left:2px solid ${p.color}}`}</style>
      ))}
      <div className={styles.editor} ref={container} />
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.footer}>
        <span>Python · Your partner sees changes as you type</span>
        <div>
          <button onClick={() => retry.current()}>Reconnect</button>
          <button onClick={() => exportCode.current()}>Download code</button>
        </div>
      </div>
    </section>
  );
}
