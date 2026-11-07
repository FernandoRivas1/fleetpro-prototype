import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendWakeGate } from './BackendWakeGate';

function healthResponse(ok: boolean): Response {
  return new Response(ok ? '{"status":"ok"}' : 'unavailable', { status: ok ? 200 : 503 });
}

describe('BackendWakeGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders the app straight away when the backend is already awake', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(healthResponse(true)));

    render(
      <BackendWakeGate>
        <p>app content</p>
      </BackendWakeGate>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('app content')).toBeTruthy();
    expect(screen.queryByText(/waking up the server/i)).toBeNull();
  });

  it('explains the wait while a sleeping backend boots, then shows the app', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(healthResponse(false))
      .mockResolvedValue(healthResponse(true));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <BackendWakeGate>
        <p>app content</p>
      </BackendWakeGate>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText(/waking up the server/i)).toBeTruthy();
    expect(screen.queryByText('app content')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(screen.getByText('app content')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('offers a retry when the backend never comes up', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(healthResponse(false)));

    render(
      <BackendWakeGate>
        <p>app content</p>
      </BackendWakeGate>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(130_000);
    });

    expect(screen.getByText(/didn't wake up/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});
