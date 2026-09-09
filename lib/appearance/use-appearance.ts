'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSetting } from '../use-local-setting';
import { GLOBAL_KEY, parseGlobal, serializeGlobal, SHIPPED_GLOBAL, type AppearanceGlobal } from './document';
import { compileOverrides } from './style-model';
import { EMPTY_ELEMENT_DOCUMENT, parseElementDocument, type ElementAppearanceDocument } from './element-document';
import { normalisePresets, type AppearancePreset } from './presets';
import { commitAppearanceHistory, createAppearanceHistory, redoAppearanceHistory, undoAppearanceHistory } from './history';
import { schemeForSeed } from './token-scheme.mjs';
import { compileAppearance } from './layers';
import { formatHex, parseColour } from '../colour';

type Snapshot = { global: AppearanceGlobal; document: ElementAppearanceDocument; presets: AppearancePreset[] };
export function useAppearance(dark: boolean) {
  const stored = useLocalSetting(GLOBAL_KEY);
  const global = useMemo(() => parseGlobal(stored.value), [stored.value]);
  const [document, setDocument] = useState<ElementAppearanceDocument>(EMPTY_ELEMENT_DOCUMENT);
  const [presets, setPresets] = useState<AppearancePreset[]>([]);
  const [ready, setReady] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [limitExceeded, setLimitExceeded] = useState(false);
  const mutations = useRef(0);
  const globalRef = useRef(global);
  useEffect(() => { globalRef.current = global; }, [global]);
  const db = useRef<IDBDatabase | null>(null);
  const pendingWrite = useRef<Snapshot | null>(null);
  const [history, setHistory] = useState(() => createAppearanceHistory<Snapshot>({ global, document, presets }, 60));
  useEffect(() => {
    let disposed = false;
    try {
      const request = indexedDB.open('gtha-appearance', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('documents'); };
      request.onerror = () => { if (!disposed) { setStorageFailed(true); setReady(true); } };
      request.onsuccess = () => {
        if (disposed) { request.result.close(); return; }
        db.current = request.result;
        if (pendingWrite.current) {
          const pending = pendingWrite.current; pendingWrite.current = null;
          const tx = db.current.transaction('documents', 'readwrite');
          tx.objectStore('documents').put({ document: JSON.stringify(pending.document), presets: pending.presets }, 'current');
          tx.onabort = tx.onerror = () => setStorageFailed(true);
          setReady(true); return;
        }
        const read = db.current.transaction('documents').objectStore('documents').get('current');
        read.onsuccess = () => {
          if (disposed) return;
          if (mutations.current !== 0) { setReady(true); return; }
          const value = read.result;
          const restored = parseElementDocument(typeof value?.document === 'string' ? value.document : null), restoredPresets = normalisePresets(value?.presets);
          try { compileAppearance(restored); setDocument(restored); setPresets(restoredPresets); setHistory(createAppearanceHistory({ global: globalRef.current, document: restored, presets: restoredPresets }, 60)); }
          catch { setStorageFailed(true); }
          setReady(true);
        };
        read.onerror = () => { if (!disposed) { setStorageFailed(true); setReady(true); } };
      };
    } catch { setStorageFailed(true); setReady(true); }
    return () => { disposed = true; db.current?.close(); db.current = null; };
  }, []);
  const persist = (next: Snapshot) => {
    if (!stored.setValue(serializeGlobal(next.global))) setStorageFailed(true);
    setDocument(next.document); setPresets(next.presets);
    if (!db.current) { pendingWrite.current = next; if (ready) setStorageFailed(true); return; }
    try {
      const tx = db.current.transaction('documents', 'readwrite');
      tx.objectStore('documents').put({ document: JSON.stringify(next.document), presets: next.presets }, 'current');
      tx.onabort = tx.onerror = () => setStorageFailed(true);
    } catch { setStorageFailed(true); }
  };
  const update = (patch: Partial<Snapshot>) => {
    const previous = { global, document, presets };
    const next = { ...previous, ...patch };
    next.global = parseGlobal(serializeGlobal(next.global));
    next.document = parseElementDocument(JSON.stringify(next.document));
    next.presets = normalisePresets(next.presets);
    try { compileAppearance(next.document); if (new TextEncoder().encode(JSON.stringify(next.document)).byteLength > 256 * 1024) throw new RangeError(); }
    catch { setLimitExceeded(true); return false; }
    mutations.current += 1;
    setLimitExceeded(false);
    setHistory(current => commitAppearanceHistory({ ...current, present: previous }, next));
    persist(next);
    return true;
  };
  const reset = () => update({ global: SHIPPED_GLOBAL, document: EMPTY_ELEMENT_DOCUMENT, presets });
  const undo = () => { const next = undoAppearanceHistory(history); setHistory(next); persist(next.present); };
  const redo = () => { const next = redoAppearanceHistory(history); setHistory(next); persist(next.present); };
  useEffect(() => {
    const emergency = (event: KeyboardEvent) => { if (event.ctrlKey && event.shiftKey && event.altKey && event.key === 'Backspace') { event.preventDefault(); reset(); } };
    window.addEventListener('keydown', emergency);
    return () => window.removeEventListener('keydown', emergency);
  }, [global, document, presets]);
  const roles = useMemo(() => global.mode === 'shipped' || !global.seed ? {} : schemeForSeed(formatHex(parseColour(global.seed)!), dark, global.sources ?? {}), [global.mode, global.seed, global.sources, dark]);
  useEffect(() => {
    const root = window.document.documentElement;
    const declarations: Record<string, string> = { ...roles };
    const allowedFonts = new Set(['Space Grotesk', 'IBM Plex Mono', 'system-ui', 'serif', 'sans-serif', 'monospace']);
    if (global.fontFamily && allowedFonts.has(global.fontFamily)) { declarations['--md-ref-typeface-plain'] = `${global.fontFamily}, sans-serif`; declarations['--md-ref-typeface-brand'] = `${global.fontFamily}, sans-serif`; }
    if (global.monoFamily && allowedFonts.has(global.monoFamily)) declarations['--md-ref-typeface-mono'] = `${global.monoFamily}, monospace`;
    declarations['--appearance-scale'] = String(global.sizeScale);
    const previous = new Map<string, string>();
    for (const [key, value] of Object.entries(declarations)) { previous.set(key, root.style.getPropertyValue(key)); root.style.setProperty(key, value); }
    root.dataset.appearanceDensity = global.density;
    root.dataset.appearanceSize = String(global.sizeScale !== 1);
    root.dataset.appearanceWeight = String(global.weightShift);
    const title = window.document.title;
    if (global.appName) window.document.title = global.appName;
    return () => { for (const [key, value] of previous) { if (value) root.style.setProperty(key, value); else root.style.removeProperty(key); } window.document.title = title; };
  }, [roles, global.fontFamily, global.monoFamily, global.density, global.sizeScale, global.weightShift, global.appName]);
  return { global, document, presets, ready, limitExceeded, storageFailed: storageFailed || stored.unavailable, update, reset, undo, redo, canUndo: history.past.length > 0, canRedo: history.future.length > 0, css: compileAppearance(document) };
}
export type AppearanceController = ReturnType<typeof useAppearance>;
