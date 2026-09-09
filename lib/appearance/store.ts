'use client';

/**
 * The React-facing half of the appearance global document.
 *
 * `persistence.ts` is deliberately generic -- a bounded get/set/remove
 * adapter that does not know what an `AppearanceGlobal` is, so the validation
 * boundary at import/export time cannot depend on which storage backs it. This
 * file is the "React-facing store" that file's own header describes: it
 * supplies the localStorage adapter, layers `document.ts`'s
 * `serializeGlobal`/`parseGlobal` on top for the actual JSON boundary, and
 * exposes one hook so every component reading or writing the global document
 * agrees on the same in-memory value rather than each keeping its own stale
 * copy.
 *
 * Same-tab reactivity is a plain module-level listener set, the same shape
 * `use-local-setting.ts` already uses. Cross-tab reactivity additionally opens
 * a `BroadcastChannel` where the browser has one; a browser without
 * `BroadcastChannel` still works within one tab, it just does not hear about a
 * change made in another tab until that tab's own write also lands here (a
 * page reload, or the native `storage` event a plain key/value read would get
 * for free but a `BroadcastChannel`-first design does not need).
 */

import { useCallback, useSyncExternalStore } from 'react';
import { GLOBAL_KEY, SHIPPED_GLOBAL, parseGlobal, serializeGlobal, type AppearanceGlobal } from './document.ts';
import { readBounded, writeBounded, type AppearancePersistence } from './persistence.ts';

const CHANNEL_NAME = 'gtha-appearance';
const LOCAL_EVENT = 'gtha-appearance-local';

/** A `localStorage`-backed adapter for `persistence.ts`'s generic contract. Never throws: a blocked or full store just fails the write. */
function localStorageAdapter(): AppearancePersistence {
  return {
    get(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Nothing to recover: the value simply outlives this attempt to clear it.
      }
    },
  };
}

/** In-memory cache, so `useSyncExternalStore`'s snapshot is a stable reference between renders rather than a fresh object read from storage every call. */
let cached: AppearanceGlobal | null = null;
let channel: BroadcastChannel | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function ensureChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (channel) return channel;
  const opened = new BroadcastChannel(CHANNEL_NAME);
  opened.addEventListener('message', () => {
    cached = null;
    notify();
  });
  channel = opened;
  return channel;
}

function readGlobal(): AppearanceGlobal {
  if (typeof window === 'undefined') return SHIPPED_GLOBAL;
  if (cached) return cached;
  const text = readBounded(localStorageAdapter(), GLOBAL_KEY);
  cached = parseGlobal(text);
  return cached;
}

function getServerSnapshot(): AppearanceGlobal {
  return SHIPPED_GLOBAL;
}

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  listeners.add(listener);
  ensureChannel();
  const onLocal = () => listener();
  window.addEventListener(LOCAL_EVENT, onLocal);
  return () => {
    listeners.delete(listener);
    window.removeEventListener(LOCAL_EVENT, onLocal);
  };
}

/** Write, update the cache, and tell every listener -- this tab first, other tabs through the channel. Returns whether the write was actually persisted (a bounds failure still updates the live value for this session). */
function writeGlobal(next: AppearanceGlobal): boolean {
  if (typeof window === 'undefined') return false;
  const persisted = writeBounded(localStorageAdapter(), GLOBAL_KEY, serializeGlobal(next));
  cached = next;
  window.dispatchEvent(new CustomEvent(LOCAL_EVENT));
  ensureChannel()?.postMessage(Date.now());
  notify();
  return persisted;
}

export type UseAppearanceGlobal = {
  global: AppearanceGlobal;
  /** Replace the whole document. Returns false when the write exceeded the bounded persistence limit; the in-memory value still updates for this session. */
  setGlobal: (next: AppearanceGlobal) => boolean;
  /** Merge a partial change into the current document. */
  patchGlobal: (patch: Partial<AppearanceGlobal>) => boolean;
};

export function useAppearanceGlobal(): UseAppearanceGlobal {
  const global = useSyncExternalStore(subscribe, readGlobal, getServerSnapshot);
  const setGlobal = useCallback((next: AppearanceGlobal) => writeGlobal(next), []);
  const patchGlobal = useCallback((patch: Partial<AppearanceGlobal>) => writeGlobal({ ...readGlobal(), ...patch }), []);
  return { global, setGlobal, patchGlobal };
}
