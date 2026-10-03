import { useCallback, useEffect, useRef, useState } from 'react';

// JSON GET with a timeout, cancelable from outside. Throws an Error carrying `.status` (0 = network).
export async function fetchJson(path, signal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const forward = () => controller.abort();
  signal?.addEventListener('abort', forward);
  try {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    let data = null;
    try { data = await response.json(); } catch { /* non-JSON error page */ }
    if (!response.ok || data === null) throw Object.assign(new Error(data?.error || `HTTP ${response.status}`), { status: response.status });
    return data;
  } catch (error) {
    throw error.status ? error : Object.assign(new Error(error.message || 'Network error'), { status: 0 });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', forward);
  }
}

// Polls `path` every `interval` ms while `enabled`.
// status: loading (nothing yet) | ready | stale (last refresh failed, older data kept) | error (failed, no data).
// An unmount or a path change aborts the request in flight and nothing is scheduled or set afterwards.
export function usePolled(path, { interval, enabled = true, validate }) {
  const [state, setState] = useState({ data: null, status: 'loading', error: null, lastUpdated: null });
  const runRef = useRef(() => {});
  const validateRef = useRef(validate);
  validateRef.current = validate;

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    let timer;
    let running = false;
    const run = async () => {
      if (running || controller.signal.aborted) return;
      running = true;
      clearTimeout(timer);
      try {
        const data = await fetchJson(path, controller.signal);
        if (validateRef.current && !validateRef.current(data)) throw Object.assign(new Error('Invalid response'), { status: 502 });
        if (!controller.signal.aborted) setState({ data, status: 'ready', error: null, lastUpdated: Date.now() });
      } catch (error) {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, status: previous.data ? 'stale' : 'error', error }));
      } finally {
        running = false;
        if (!controller.signal.aborted) timer = setTimeout(run, interval);
      }
    };
    runRef.current = run;
    run();
    return () => {
      controller.abort();
      clearTimeout(timer);
      runRef.current = () => {};
    };
  }, [path, interval, enabled]);

  const retry = useCallback(() => {
    setState((previous) => (previous.data ? previous : { ...previous, status: 'loading' }));
    runRef.current();
  }, []);

  return { ...state, retry };
}

// F36: departures refresh every 60 s. Services change rarely; the same rate is plenty.
export const useTransports = (enabled = true) => usePolled('/api/transports', { interval: 60_000, enabled });
export const useServices = (enabled = true) => usePolled('/api/services', { interval: 60_000, enabled });
// F45 / F46: places rarely change, so 5 minutes is plenty.
export const usePlaces = (enabled = true) => usePolled('/api/places', { interval: 300_000, enabled, validate: (data) => Array.isArray(data?.places) });
