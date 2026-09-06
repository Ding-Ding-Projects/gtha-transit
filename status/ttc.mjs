import { readFile } from 'node:fs/promises';

export const TTC_ALERTS_URL = 'https://bustime.ttc.ca/gtfsrt/alerts';
export const TTC_WEB_ALERTS_URL = 'https://www.ttc.ca/ttcapi/routedetail/getallroutesandstopsalerts';
export const TTC_LINES = [
  { id: '1', name: 'Line 1 Yonge-University', color: '#D5C82B' },
  { id: '2', name: 'Line 2 Bloor-Danforth', color: '#008000' },
  { id: '4', name: 'Line 4 Sheppard', color: '#B300B3' },
  { id: '5', name: 'Line 5 Eglinton', color: '#FF8000' },
  { id: '6', name: 'Line 6 Finch West', color: '#808080' },
];

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ENTITIES = 2000;
const MAX_WEB_ALERTS = 5000;
const MAX_ROUTE_REFS = 250;
const MAX_TEXT = 2000;
const MAX_AGE_MS = 10 * 60 * 1000;
const CACHE_MS = 45_000;
let cache = null;

const text = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
const iso = (seconds) => Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined;
const timestamp = (value) => {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/i.test(value)) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
};

function fields(bytes) {
  const out = [];
  let p = 0;
  const readVarint = () => {
    let value = 0n;
    for (let shift = 0n; p < bytes.length && shift <= 63n; shift += 7n) {
      const b = bytes[p++]; value |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return value;
    }
    throw new Error('invalid protobuf varint');
  };
  while (p < bytes.length) {
    const key = Number(readVarint()); const number = key >>> 3; const wire = key & 7;
    if (!number || wire === 4) throw new Error('invalid protobuf field');
    if (wire === 0) out.push([number, readVarint()]);
    else if (wire === 2) { const length = Number(readVarint()); if (length < 0 || p + length > bytes.length) throw new Error('invalid protobuf length'); out.push([number, bytes.subarray(p, p + length)]); p += length; }
    else if (wire === 1) { if (p + 8 > bytes.length) throw new Error('invalid protobuf fixed64'); out.push([number, bytes.subarray(p, p + 8)]); p += 8; }
    else if (wire === 5) { if (p + 4 > bytes.length) throw new Error('invalid protobuf fixed32'); out.push([number, bytes.subarray(p, p + 4)]); p += 4; }
    else throw new Error('unsupported protobuf wire type');
  }
  return out;
}
const first = (fs, n) => fs.find(([k]) => k === n)?.[1];
const many = (fs, n) => fs.filter(([k]) => k === n).map(([, v]) => v);
const utf8 = (value) => text(new TextDecoder('utf-8', { fatal: false }).decode(value));

function translated(bytes) {
  const translations = many(fields(bytes), 1).map((v) => fields(v)).map((f) => ({ text: utf8(first(f, 1) ?? new Uint8Array()), language: utf8(first(f, 2) ?? new Uint8Array()) })).filter((v) => v.text);
  return translations.find((v) => /^en(?:-|$)/i.test(v.language))?.text ?? translations[0]?.text ?? '';
}
function routeReferences(bytes) {
  const refs = [];
  let network = false;
  let routes = false;
  let unknown = false;
  const selectors = many(fields(bytes), 5);
  if (selectors.length > MAX_ROUTE_REFS) throw new Error('TTC alert route selector count exceeds the safety bound');
  for (const selectorBytes of selectors) {
    const selector = fields(selectorBytes);
    const routeId = utf8(first(selector, 2) ?? new Uint8Array());
    const type = first(selector, 3);
    const routeType = typeof type === 'bigint' && type >= 0n && type <= 2147483647n ? Number(type) : undefined;
    if (routeId || routeType !== undefined) { routes = true; refs.push({ ...(routeId ? { routeId } : {}), ...(routeType !== undefined ? { routeType } : {}) }); }
    else if (selector.length && selector.every(([number]) => number === 1)) network = true;
    else unknown = true;
  }
  const uniqueRefs = [];
  const seenRefs = new Set();
  for (const ref of refs) {
    const key = `${ref.routeId ?? ''}\u0000${ref.routeType ?? ''}`;
    if (!seenRefs.has(key)) { seenRefs.add(key); uniqueRefs.push(ref); }
  }
  return { refs: uniqueRefs, scope: network ? 'network' : routes ? 'routes' : unknown ? 'unknown' : 'unknown' };
}
function parseAlert(bytes, entityId, feedTimestamp, now) {
  const fs = fields(bytes);
  const periods = many(fs, 1).map((v) => fields(v)).map((f) => ({ start: iso(Number(first(f, 1) ?? 0n)), end: iso(Number(first(f, 2) ?? 0n)) }));
  const routeMetadata = routeReferences(bytes);
  const routeRefs = routeMetadata.refs;
  const routes = [...new Set(routeRefs.map((ref) => ref.routeId).filter(Boolean))];
  const header = translated(first(fs, 10) ?? new Uint8Array());
  const description = translated(first(fs, 11) ?? new Uint8Array());
  const activeFrom = periods.map((p) => p.start).filter(Boolean).sort()[0];
  const activeTo = periods.map((p) => p.end).filter(Boolean).sort().at(-1);
  const active = periods.length === 0 || periods.some((period) => (!period.start || Date.parse(period.start) <= now) && (!period.end || Date.parse(period.end) >= now));
  return { alert: { id: text(entityId) || `ttc-alert-${feedTimestamp}`, title: header || 'TTC service alert', description, url: /^https:\/\//i.test(translated(first(fs, 8) ?? new Uint8Array())) ? translated(first(fs, 8) ?? new Uint8Array()) : '', updatedAt: iso(feedTimestamp) ?? new Date().toISOString(), routeIds: routes, routeRefs, routeScope: routeMetadata.scope, ...(activeFrom ? { activeFrom } : {}), ...(activeTo ? { activeTo } : {}) }, routes, scope: routeMetadata.scope, active };
}

export function parseTtcAlerts(bytes, { fetchedAt = new Date().toISOString(), now = Date.now() } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_BYTES) throw new Error('TTC alert payload exceeds the safety bound');
  const root = fields(bytes);
  const header = first(root, 1);
  const headerFields = header ? fields(header) : [];
  const version = utf8(first(headerFields, 1) ?? new Uint8Array());
  const feedTimestamp = Number(first(headerFields, 3) ?? 0n);
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(version) || !feedTimestamp) throw new Error('TTC feed header is missing required version or timestamp');
  const entities = many(root, 2);
  if (entities.length > MAX_ENTITIES) throw new Error('TTC alert entity count exceeds the safety bound');
  const parsed = entities.map((entity) => { const fs = fields(entity); const id = utf8(first(fs, 1) ?? new Uint8Array()); const alert = first(fs, 5); return alert ? parseAlert(alert, id, feedTimestamp, now) : null; }).filter(Boolean);
  const alerts = parsed.filter((v) => v.active).map((v) => v.alert);
  const age = now - feedTimestamp * 1000;
  const state = age > MAX_AGE_MS || age < -60_000 ? 'stale' : 'live';
  const coveredRoutes = new Set(parsed.flatMap((v) => v.routes));
  const lines = TTC_LINES.map((line) => { const lineAlerts = parsed.filter((v) => v.active && (v.scope === 'network' || v.routes.includes(line.id))).map((v) => v.alert); const covered = coveredRoutes.has(line.id) || parsed.some((v) => v.active && v.scope === 'network'); return { ...line, state: state === 'live' && covered ? (lineAlerts.length ? 'disrupted' : 'good') : 'unknown', alerts: lineAlerts }; });
  return { state, fetchedAt, sourceUpdatedAt: iso(feedTimestamp), sourceUrl: TTC_ALERTS_URL, lines, alerts };
}

/**
 * The same decoder, under a name that says what it is.
 *
 * A GTFS-Realtime alert feed has one shape whoever publishes it, so the Metrolinx
 * feed is read by exactly this code. Only the `lines` summary in the result is
 * specific to the TTC, and a caller reading another agency's feed uses `alerts`.
 */
export const parseAlertFeed = parseTtcAlerts;

export function unavailableTtcStatus({ fetchedAt = new Date().toISOString() } = {}) {
  return { state: 'unavailable', fetchedAt, sourceUrl: TTC_WEB_ALERTS_URL, lines: TTC_LINES.map((line) => ({ ...line, state: 'unknown', alerts: [] })), alerts: [] };
}

function unknownLines() { return TTC_LINES.map((line) => ({ ...line, state: 'unknown', alerts: [] })); }

function staleTtcStatus(value) {
  return { ...value, state: 'stale', lines: unknownLines() };
}

/**
 * The publisher types each route reference. A transit mode describes service; a
 * facility type such as Escalator or Elevator describes fixed equipment inside a
 * station. An escalator out of service must never mark a whole line disrupted,
 * so only a service-affecting alert decides a line's state. Facility notices stay
 * listed against the line.
 */
const TRANSIT_ROUTE_TYPES = new Set(['subway', 'bus', 'streetcar', 'tram', 'light rail', 'lightrail', 'rail', 'ferry', '0', '1', '2', '3', '4', '5', '6', '7', '11', '12']);

export function isServiceRouteType(routeType) {
  const value = String(routeType ?? '').trim().toLowerCase();
  if (!value) return true;
  return TRANSIT_ROUTE_TYPES.has(value);
}

/** The exact stops the publisher named as the ends of a closed or diverted segment. */
function segmentOf(item) {
  const startName = text(item.stopStart);
  const endName = text(item.stopEnd);
  const startId = text(item.stopStartId);
  const endId = text(item.stopEndId);
  if (!startName && !endName && !startId && !endId) return undefined;
  return { ...(startName ? { startName } : {}), ...(endName ? { endName } : {}), ...(startId ? { startId } : {}), ...(endId ? { endId } : {}) };
}

const MAX_AFFECTED_STOPS = 400;

/** Every stop the publisher itself lists as affected. Bounded, and never extended. */
function affectedStopsOf(item) {
  if (!Array.isArray(item.stops)) return undefined;
  if (item.stops.length > MAX_AFFECTED_STOPS) throw new Error('TTC web alert affected stop count exceeds the safety bound');
  const ids = [...new Set(item.stops.map((stop) => text(stop)).filter(Boolean))];
  return ids.length ? ids : undefined;
}

/** Officially announced shuttle service only. An absent field stays absent. */
function shuttleOf(item) {
  const type = text(item.shuttleType);
  const start = text(item.shuttleStart);
  const end = text(item.shuttleEnd);
  if (!type && !start && !end) return undefined;
  return { ...(type ? { type } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}) };
}

export function parseTtcWebAlerts(payload, { fetchedAt = new Date().toISOString(), now = Date.now() } = {}) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.routeAlerts) || typeof payload.lastUpdated !== 'string') throw new Error('TTC web alert payload is incomplete');
  if (payload.routeAlerts.length > MAX_WEB_ALERTS) throw new Error('TTC web alert count exceeds the safety bound');
  const sourceUpdatedAtRaw = text(payload.lastUpdated);
  const sourceUpdatedAt = timestamp(sourceUpdatedAtRaw);
  if (!timestamp(fetchedAt)) throw new Error('TTC fetch timestamp must include an explicit timezone');
  const alerts = payload.routeAlerts.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('TTC web alert entry is invalid');
    const routes = [...new Set(String(item.route ?? '').split(/[|,]/).map((route) => text(route)).filter(Boolean))];
    if (routes.length > MAX_ROUTE_REFS) throw new Error('TTC web alert route reference count exceeds the safety bound');
    const routeType = text(item.routeType);
    const routeScope = routes.length ? 'routes' : routeType ? 'unknown' : 'network';
    const routeRefs = routes.length ? routes.map((routeId) => ({ routeId, ...(routeType ? { routeType } : {}) })) : routeType ? [{ routeType }] : [];
    const period = item.activePeriod ?? {};
    if (!period || typeof period !== 'object') throw new Error('TTC web alert period is invalid');
    const start = period.start ? timestamp(period.start) : undefined;
    const end = period.end && !String(period.end).startsWith('0001-') ? timestamp(period.end) : undefined;
    if ((period.start && !start) || (period.end && !String(period.end).startsWith('0001-') && !end)) throw new Error('TTC web alert period timestamp must include an explicit timezone');
    const active = (!start || Date.parse(start) <= now) && (!end || Date.parse(end) >= now);
    const effect = text(item.effectDesc);
    const disrupted = !/^regular service(?:\s|$)/i.test(effect);
    const serviceAffecting = disrupted && isServiceRouteType(routeType);
    // The publisher names the closed segment and any official shuttle itself. Both are
    // retained verbatim; nothing about a shuttle stop, time or vehicle is ever derived.
    const segment = segmentOf(item);
    const shuttle = shuttleOf(item);
    const affectedStopIds = affectedStopsOf(item);
    return { routes, routeScope, active, disrupted, serviceAffecting, alert: { id: text(item.id) || `ttc-web-${routes.join('-') || 'network'}`, title: text(item.headerText || item.title) || 'TTC service alert', description: text(item.title || effect), url: /^https:\/\//i.test(item.url ?? '') ? text(item.url) : 'https://www.ttc.ca/service-alerts', updatedAt: timestamp(item.lastUpdated) || sourceUpdatedAt || timestamp(fetchedAt), routeIds: routes, routeRefs, routeScope, ...(effect ? { effect } : {}), ...(text(item.direction) ? { direction: text(item.direction) } : {}), ...(segment ? { segment } : {}), ...(shuttle ? { shuttle } : {}), ...(affectedStopIds ? { affectedStopIds } : {}), ...(start ? { activeFrom: start } : {}), ...(end ? { activeTo: end } : {}) } };
  }).filter((item) => item.active);
  const lines = TTC_LINES.map((line) => {
    const onLine = alerts.filter((item) => item.disrupted && (item.routeScope === 'network' || item.routes.includes(line.id)));
    const serviceAlerts = onLine.filter((item) => item.serviceAffecting);
    return { ...line, state: serviceAlerts.length ? 'disrupted' : 'good', alerts: onLine.map((item) => item.alert), serviceAlertCount: serviceAlerts.length, facilityAlertCount: onLine.length - serviceAlerts.length };
  });
  return { state: 'live', fetchedAt: timestamp(fetchedAt), sourceUpdatedAtRaw, ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}), sourceUrl: TTC_WEB_ALERTS_URL, lines, alerts: alerts.map((item) => item.alert) };
}

export async function getTtcStatus({ fetchImpl = globalThis.fetch, now = Date.now(), timeoutMs = 8_000, fixturePath } = {}) {
  if (cache && now - cache.receivedAt < CACHE_MS) return cache.value;
  const safeTimeoutMs = Number.isFinite(timeoutMs) ? Math.min(Math.max(timeoutMs, 1), 30_000) : 8_000;
  try {
    if (!fixturePath && typeof fetchImpl === 'function') {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), safeTimeoutMs);
      try { const response = await fetchImpl(TTC_WEB_ALERTS_URL, { headers: { accept: 'application/json' }, redirect: 'error', signal: controller.signal }); if (!response.ok) throw new Error(`TTC web alerts returned HTTP ${response.status}`); const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedBody(response, MAX_BYTES))); const value = parseTtcWebAlerts(payload, { fetchedAt: new Date(now).toISOString(), now }); cache = { receivedAt: now, value }; return value; }
      catch { /* fall through to the official GTFS-Realtime source */ }
      finally { clearTimeout(timer); }
    }
    let bytes;
    if (fixturePath) bytes = new Uint8Array(await readFile(fixturePath));
    else {
      if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), safeTimeoutMs);
      try { const response = await fetchImpl(TTC_ALERTS_URL, { headers: { accept: 'application/x-google-protobuf' }, redirect: 'error', signal: controller.signal }); if (!response.ok) throw new Error(`TTC feed returned HTTP ${response.status}`); const length = Number(response.headers?.get?.('content-length') ?? 0); if (length > MAX_BYTES) throw new Error('TTC alert payload exceeds the safety bound'); bytes = await readBoundedBody(response, MAX_BYTES); }
      finally { clearTimeout(timer); }
    }
    const value = parseTtcAlerts(bytes, { fetchedAt: new Date(now).toISOString(), now }); cache = { receivedAt: now, value }; return value;
  } catch {
    if (cache) return staleTtcStatus(cache.value);
    return unavailableTtcStatus({ fetchedAt: new Date(now).toISOString() });
  }
}

async function readBoundedBody(response, limit) {
  if (!response.body?.getReader) { const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.byteLength > limit) throw new Error('TTC alert payload exceeds the safety bound'); return bytes; }
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > limit) throw new Error('TTC alert payload exceeds the safety bound'); chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}

export function clearTtcStatusCache() { cache = null; }
