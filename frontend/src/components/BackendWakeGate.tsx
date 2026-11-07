import { useEffect, useState, type ReactNode } from 'react';
import { API_BASE_URL } from '../lib/api';
import './BackendWakeGate.css';

/** The backend runs on a free hosting tier that sleeps when idle, so the
 * first request after a quiet spell can take 30-60s. Rather than let every
 * screen sit on a silent spinner (or fail its first fetch), this gate pings
 * /health before rendering the app and, only if that's slow, explains what
 * is happening. A warm backend answers well inside QUIET_PERIOD_MS, so
 * visitors normally never see this screen at all. */
const QUIET_PERIOD_MS = 1500;
const PING_TIMEOUT_MS = 10000;
const RETRY_DELAY_MS = 2500;
const GIVE_UP_AFTER_MS = 120000;
const EXPECTED_WAKE_SECONDS = 50;

type GateState = 'checking' | 'waking' | 'ready' | 'failed';

async function pingHealth(signal: AbortSignal): Promise<boolean> {
  const timeout = AbortSignal.timeout(PING_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE_URL}/health`, { signal: AbortSignal.any([signal, timeout]) });
    return res.ok;
  } catch {
    return false;
  }
}

export function BackendWakeGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>('checking');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const quietTimer = window.setTimeout(() => setState((s) => (s === 'checking' ? 'waking' : s)), QUIET_PERIOD_MS);
    const ticker = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);

    (async () => {
      while (!controller.signal.aborted) {
        if (await pingHealth(controller.signal)) {
          setState('ready');
          return;
        }
        if (Date.now() - startedAt > GIVE_UP_AFTER_MS) {
          setState('failed');
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS));
      }
    })().finally(() => {
      window.clearTimeout(quietTimer);
      window.clearInterval(ticker);
    });

    return () => controller.abort();
  }, [attempt]);

  if (state === 'ready') return <>{children}</>;
  // Stay blank during the quiet period so a fast backend doesn't flash this screen.
  if (state === 'checking') return null;

  const progress = Math.min(elapsedSeconds / EXPECTED_WAKE_SECONDS, 0.95);

  return (
    <div className="wake-gate" role="status" aria-live="polite">
      <div className="wake-gate__card">
        <div className="wake-gate__brand">Rental Software</div>
        {state === 'waking' ? (
          <>
            <div className="wake-gate__spinner" aria-hidden="true" />
            <h1 className="wake-gate__title">Waking up the server…</h1>
            <p className="wake-gate__text">
              This demo's backend runs on a free hosting tier that goes to sleep when nobody is using it. The first
              visit after a quiet period takes about a minute; after that, everything is instant.
            </p>
            <div className="wake-gate__bar" aria-hidden="true">
              <div className="wake-gate__bar-fill" style={{ width: `${progress * 100}%` }} />
            </div>
            <p className="wake-gate__elapsed">{elapsedSeconds}s elapsed</p>
          </>
        ) : (
          <>
            <h1 className="wake-gate__title">The server didn't wake up</h1>
            <p className="wake-gate__text">
              It's taking longer than usual to start. This is usually temporary; please try again in a moment.
            </p>
            <button
              type="button"
              className="wake-gate__retry"
              onClick={() => {
                setElapsedSeconds(0);
                setState('waking');
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
