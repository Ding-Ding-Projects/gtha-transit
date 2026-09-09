/**
 * Browser-independent bounded persistence adapter. The React-facing store can
 * supply localStorage or an IndexedDB-backed adapter without changing the
 * validation boundary at import/export time.
 */
export type AppearancePersistence = { get(key: string): string | null; set(key: string, value: string): boolean; remove(key: string): void };
export const MAX_PERSISTED_BYTES = 12 * 1024;

export function writeBounded(store: AppearancePersistence, key: string, value: string): boolean {
  if (new TextEncoder().encode(value).byteLength > MAX_PERSISTED_BYTES) return false;
  return store.set(key, value);
}

export function readBounded(store: AppearancePersistence, key: string): string | null {
  const value = store.get(key);
  return value !== null && new TextEncoder().encode(value).byteLength <= MAX_PERSISTED_BYTES ? value : null;
}
