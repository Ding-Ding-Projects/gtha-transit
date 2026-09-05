'use client';
import { useCallback, useSyncExternalStore } from 'react';

const eventName = 'gtha-local-setting';
const emptySnapshot = JSON.stringify([null, false]);
const volatile = new Map<string, string>();
const serverSnapshot = () => emptySnapshot;

/** Bounded visitor-local storage with hydration-safe snapshots and tab synchronization. */
export function useLocalSetting(key: string) {
  const subscribe = useCallback((notify: () => void) => {
    const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) { volatile.delete(key); notify(); } };
    const onLocal = (event: Event) => { if ((event as CustomEvent<string>).detail === key) notify(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener(eventName, onLocal);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(eventName, onLocal); };
  }, [key]);
  const getSnapshot = useCallback(() => {
    if (volatile.has(key)) return JSON.stringify([volatile.get(key), true]);
    try { const raw = localStorage.getItem(key); return raw && raw.length > 16384 ? JSON.stringify([null, true]) : JSON.stringify([raw, false]); }
    catch { return JSON.stringify([null, true]); }
  }, [key]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  const [value, unavailable] = JSON.parse(snapshot) as [string | null, boolean];
  const setValue = useCallback((value: string) => {
    if (value.length > 16384) return false;
    let persisted = true;
    try { localStorage.setItem(key, value); volatile.delete(key); }
    catch { volatile.set(key, value); persisted = false; }
    window.dispatchEvent(new CustomEvent(eventName, { detail: key }));
    return persisted;
  }, [key]);
  return { value, unavailable, setValue };
}
