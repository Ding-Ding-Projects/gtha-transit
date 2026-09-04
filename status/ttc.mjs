import { readFile } from 'node:fs/promises';

export const TTC_ALERTS_URL = 'https://bustime.ttc.ca/gtfsrt/alerts';
export const TTC_LINES = [
  { id: '1', name: 'Line 1 Yonge-University', color: '#f4c300' },
  { id: '2', name: 'Line 2 Bloor-Danforth', color: '#1d7a3a' },
  { id: '4', name: 'Line 4 Sheppard', color: '#6a1b9a' },
  { id: '5', name: 'Line 5 Eglinton', color: '#8a1538' },
  { id: '6', name: 'Line 6 Finch West', color: '#00838f' },
];

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ENTITIES = 2000;
const MAX_TEXT = 2000;
const MAX_AGE_MS = 10 * 60 * 1000;
const CACHE_MS = 45_000;
let cache = null;

const text = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
const iso = (seconds) => Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined;

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
function routeIds(bytes) {
  return many(fields(bytes), 5).map((v) => utf8(first(fields(v), 2) ?? new Uint8Array())).filter(Boolean);
}
function parseAlert(bytes, entityId) {
  const fs = fields(bytes);
  const periods = many(fs, 1).map((v) => fields(v)).map((f) => ({ start: iso(Number(first(f, 1) ?? 0n)), end: iso(Number(first(f, 2) ?? 0n)) }));
  const routes = [...new Set(routeIds(bytes))];
  const header = translated(first(fs, 10) ?? new Uint8Array());
  const description = translated(first(fs, 11) ?? new Uint8Array());
  const activeFrom = periods.map((p) => p.start).filter(Boolean).sort()[0];
  const activeTo = periods.map((p) => p.end).filter(Boolean).sort().at(-1);
  const now = Date.now();
  const active = (!activeFrom || Date.parse(activeFrom) <= now) && (!activeTo || Date.parse(activeTo) >= now);
  return { alert: { id: text(entityId) || `ttc-${Math.random().toString(36).slice(2)}`, title: header || 'TTC service alert', description, url: translated(first(fs, 8) ?? new Uint8Array()), updatedAt: new Date().toISOString(), ...(activeFrom ? { activeFrom } : {}), ...(activeTo ? { activeTo } : {}) }, routes, active };
}

export function parseTtcAlerts(bytes, { fetchedAt = new Date().toISOString() } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_BYTES) throw new Error('TTC alert payload exceeds the safety bound');
  const entities = many(fields(bytes),  entityField()).slice(0, MAX_ENTITIES);
  const parsed = entities.map((entity) => { const fs = fields(entity); const id = utf8(first(fs, 1) ?? new Uint8Array()); const alert = first(fs, 5); return alert ? parseAlert(alert, id) : null; }).filter(Boolean);
  const alerts = parsed.filter((v) => v.active).map((v) => v.alert);
  const lines = TTC_LINES.map((line) => { const lineAlerts = parsed.filter((v) => v.active && v.routes.includes(line.id)).map((v) => v.alert); return { ...line, state: lineAlerts.length ? 'disrupted' : 'good', alerts: lineAlerts }; });
  return { state: 'live', fetchedAt, sourceUrl: TTC_ALERTS_URL, lines, alerts };
}
function entityField() { return 1; }

export function unavailableTtcStatus({ fetchedAt = new Date().toISOString() } = {}) {
  return { state: 'unavailable', fetchedAt, sourceUrl: TTC_ALERTS_URL, lines: TTC_LINES.map((line) => ({ ...line, state: 'unknown', alerts: [] })), alerts: [] };
}

export async function getTtcStatus({ fetchImpl = globalThis.fetch, now = Date.now(), timeoutMs = 8_000, fixturePath } = {}) {
  if (cache && now - cache.receivedAt < CACHE_MS) return cache.value;
  try {
    let bytes;
    if (fixturePath) bytes = new Uint8Array(await readFile(fixturePath));
    else {
      if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
      try { const response = await fetchImpl(TTC_ALERTS_URL, { headers: { accept: 'application/x-google-protobuf' }, signal: controller.signal }); if (!response.ok) throw new Error(`TTC feed returned HTTP ${response.status}`); const length = Number(response.headers?.get?.('content-length') ?? 0); if (length > MAX_BYTES) throw new Error('TTC alert payload exceeds the safety bound'); bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.byteLength > MAX_BYTES) throw new Error('TTC alert payload exceeds the safety bound'); }
      finally { clearTimeout(timer); }
    }
    const value = parseTtcAlerts(bytes, { fetchedAt: new Date(now).toISOString() }); cache = { receivedAt: now, value }; return value;
  } catch {
    if (cache) return { ...cache.value, state: 'stale' };
    return unavailableTtcStatus({ fetchedAt: new Date(now).toISOString() });
  }
}

export function clearTtcStatusCache() { cache = null; }
