export type RouteRecord = {
  id: string;
  routeId: string;
  feedId: string;
  agency: string | null;
  shortName: string | null;
  longName: string | null;
  color: string | null;
  textColor: string | null;
  validity: { serviceStart?: string | null; serviceEnd?: string | null };
};
export type RouteCatalogSnapshot = { records: RouteRecord[]; date: string };
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const display = (value: unknown): value is string | null => value === null || (typeof value === 'string' && value.length <= 1024);
const dateBound = (value: unknown) => {
  if (value == null) return true;
  if (typeof value !== 'string' || !/^[0-9]{8}$/.test(value)) return false;
  const parsed = new Date(value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6, 8) + 'T00:00:00Z');
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10).replaceAll('-', '') === value;
};
const color = (value: unknown): string | null => typeof value === 'string' && /^[a-f0-9]{6}$/i.test(value) ? value : null;

function readRoute(value: unknown): RouteRecord {
  if (!isObject(value) || !identity(value.id) || !identity(value.routeId) || !identity(value.feedId)) throw new Error('invalid-route-identity');
  if (![value.agency, value.shortName, value.longName].every(display)) throw new Error('invalid-route-display');
  if (!isObject(value.validity) || !dateBound(value.validity.serviceStart) || !dateBound(value.validity.serviceEnd)) throw new Error('invalid-route-validity');
  if (typeof value.validity.serviceStart === 'string' && typeof value.validity.serviceEnd === 'string' && value.validity.serviceStart > value.validity.serviceEnd) throw new Error('invalid-route-period');
  return {
    id: value.id, routeId: value.routeId, feedId: value.feedId,
    agency: value.agency as string | null, shortName: value.shortName as string | null,
    longName: value.longName as string | null, color: color(value.color), textColor: color(value.textColor),
    validity: { serviceStart: value.validity.serviceStart as string | null | undefined, serviceEnd: value.validity.serviceEnd as string | null | undefined },
  };
}

export async function loadRouteCatalog(date: string, options: { signal: AbortSignal; fetcher?: Fetcher; onProgress?: (count: number) => void }): Promise<RouteCatalogSnapshot> {
  const parsedDate = new Date(date + 'T00:00:00Z');
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !Number.isFinite(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date) throw new Error('invalid-catalog-date');
  const fetcher = options.fetcher ?? fetch;
  const records: RouteRecord[] = [];
  const identities = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  let total: number | null = null;
  for (let page = 0; page < 50; page++) {
    options.signal.throwIfAborted();
    const params = new URLSearchParams({ limit: '200', date });
    if (cursor !== null) params.set('cursor', cursor);
    const response = await fetcher('/api/routes?' + params, { signal: options.signal });
    if (!response.ok) throw new Error('catalog-unavailable');
    const data: unknown = await response.json();
    options.signal.throwIfAborted();
    if (!isObject(data) || !Array.isArray(data.routes) || data.routes.length > 200) throw new Error('invalid-catalog-page');
    if (!Number.isSafeInteger(data.total) || Number(data.total) < 0 || Number(data.total) > 10000) throw new Error('invalid-catalog-total');
    if (total !== null && data.total !== total) throw new Error('catalog-changed');
    total = data.total as number;
    if (!isObject(data.coverage) || data.coverage.date !== date) throw new Error('catalog-date-mismatch');
    if (data.nextCursor !== null && (typeof data.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,16}$/.test(data.nextCursor) || cursors.has(data.nextCursor))) throw new Error('invalid-catalog-cursor');
    for (const value of data.routes) {
      const route = readRoute(value);
      const key = route.feedId + '\u0000' + route.routeId;
      if (identities.has(key)) throw new Error('duplicate-catalog-route');
      identities.add(key);
      records.push(route);
    }
    if (records.length > total) throw new Error('catalog-count-mismatch');
    options.onProgress?.(records.length);
    if (data.nextCursor === null) {
      if (records.length !== total) throw new Error('incomplete-catalog');
      return { records, date };
    }
    if (!data.routes.length) throw new Error('empty-catalog-page');
    cursor = data.nextCursor as string;
    cursors.add(cursor);
  }
  throw new Error('catalog-page-limit');
}

export function routePeriodState(route: RouteRecord, date: string): 'within' | 'outside' | 'unknown' {
  const { serviceStart, serviceEnd } = route.validity;
  const compact = date.replaceAll('-', '');
  if ((serviceStart && compact < serviceStart) || (serviceEnd && compact > serviceEnd)) return 'outside';
  return serviceStart && serviceEnd ? 'within' : 'unknown';
}

export function canChooseCatalogRoute(records: readonly RouteRecord[], agency: string, route: string, allowed: readonly string[] | undefined, singleRoute: boolean): boolean {
  if (allowed && !allowed.includes(agency)) return false;
  if (!route) return !singleRoute && (agency === 'all' ? !allowed : records.some(record => record.feedId === agency));
  return records.some(record => record.feedId === agency && record.routeId === route);
}
