import { readFile } from 'node:fs/promises';

const FEED_TYPES = ['vehiclePositions', 'tripUpdates', 'serviceAlerts'];
const CAPABILITY_STATES = new Set(['public', 'access_required', 'scheduled_only', 'unavailable']);

export async function loadRegistry(path = new URL('./registry.json', import.meta.url)) {
  const registry = JSON.parse(await readFile(path, 'utf8'));
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.agencies) || registry.agencies.length !== 11) {
    throw new Error('Expected schema version 1 and exactly 11 agencies.');
  }
  const ids = new Set();
  for (const agency of registry.agencies) {
    if (!agency.id || ids.has(agency.id) || !agency.name || !agency.officialSource || !agency.capabilities) throw new Error('Invalid agency registry entry.');
    ids.add(agency.id);
    for (const type of FEED_TYPES) if (!CAPABILITY_STATES.has(agency.capabilities[type])) throw new Error(`Invalid ${agency.id} ${type} capability.`);
  }
  return registry;
}

function readVarint(bytes, offset) {
  let value = 0; let shift = 0;
  while (offset < bytes.length && shift < 64) {
    const byte = bytes[offset++]; value += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return { value, offset };
    shift += 7;
  }
  throw new Error('Malformed protobuf varint.');
}

function skipField(bytes, offset, wireType) {
  if (wireType === 0) return readVarint(bytes, offset).offset;
  if (wireType === 1) return offset + 8;
  if (wireType === 2) { const length = readVarint(bytes, offset); return length.offset + length.value; }
  if (wireType === 5) return offset + 4;
  throw new Error(`Unsupported protobuf wire type ${wireType}.`);
}

function readTextField(bytes, expectedField) {
  let offset = 0;
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset); offset = key.offset;
    const field = Math.floor(key.value / 8); const wireType = key.value % 8;
    if (field === expectedField && wireType === 2) {
      const length = readVarint(bytes, offset); return new TextDecoder().decode(bytes.subarray(length.offset, length.offset + length.value));
    }
    offset = skipField(bytes, offset, wireType);
  }
  return undefined;
}

/** Validates the common GTFS-RT FeedMessage envelope without interpreting agency-specific entities. */
export function inspectGtfsRealtime(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('GTFS-RT response was empty.');
  let offset = 0; let version; let entities = 0;
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset); offset = key.offset;
    const field = Math.floor(key.value / 8); const wireType = key.value % 8;
    if (field === 1 && wireType === 2) {
      const length = readVarint(bytes, offset); const header = bytes.subarray(length.offset, length.offset + length.value);
      version = readTextField(header, 1); offset = length.offset + length.value;
    } else {
      if (field === 2 && wireType === 2) entities += 1;
      offset = skipField(bytes, offset, wireType);
    }
    if (offset > bytes.length) throw new Error('Malformed protobuf length.');
  }
  if (!version) throw new Error('GTFS-RT FeedMessage header has no version.');
  return { gtfsRealtimeVersion: version, entityCount: entities };
}

async function readBoundedBody(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`Response exceeds ${maxBytes} byte limit.`);
  const reader = response.body?.getReader(); if (!reader) throw new Error('Response has no body.');
  const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength; if (total > maxBytes) throw new Error(`Response exceeds ${maxBytes} byte limit.`);
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

export class RealtimeAggregator {
  #cache = new Map();
  constructor({ registry, fetchImpl = fetch, timeoutMs = 8_000, maxBytes = 10 * 1024 * 1024, cacheMs = 45_000, now = () => Date.now() }) {
    this.registry = registry; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; this.maxBytes = maxBytes; this.cacheMs = cacheMs; this.now = now;
  }
  async #probe(url) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal, headers: { Accept: '*/*' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return inspectGtfsRealtime(await readBoundedBody(response, this.maxBytes));
    } finally { clearTimeout(timeout); }
  }
  async refresh() {
    const checkedAt = new Date(this.now()).toISOString();
    const agencies = await Promise.all(this.registry.agencies.map(async agency => {
      const feeds = {};
      for (const type of FEED_TYPES) {
        const capability = agency.capabilities[type]; const key = `${agency.id}:${type}`; const prior = this.#cache.get(key);
        if (capability !== 'public') { feeds[type] = { state: capability, url: agency.feeds?.[type], reason: agency.unavailableReason ?? (capability === 'access_required' ? 'Official access registration is required.' : undefined) }; continue; }
        if (prior && this.now() - prior.checkedAtMs < this.cacheMs) { feeds[type] = { ...prior.value, cached: true }; continue; }
        try {
          const inspection = await this.#probe(agency.feeds[type]);
          const value = { state: 'live', url: agency.feeds[type], checkedAt, lastSuccessfulFetch: checkedAt, ...inspection };
          this.#cache.set(key, { checkedAtMs: this.now(), value }); feeds[type] = value;
        } catch (error) {
          const stale = prior?.value;
          feeds[type] = stale ? { ...stale, state: 'stale', checkedAt, error: error.message } : { state: 'unavailable', url: agency.feeds[type], checkedAt, error: error.message };
        }
      }
      const liveCount = Object.values(feeds).filter(feed => feed.state === 'live').length;
      const publicCount = Object.values(agency.capabilities).filter(state => state === 'public').length;
      const staleCount = Object.values(feeds).filter(feed => feed.state === 'stale').length;
      const state = liveCount === 3 ? 'live' : liveCount > 0 ? 'partial' : staleCount > 0 ? 'stale' : Object.values(agency.capabilities).every(state => state === 'scheduled_only') ? 'scheduled_only' : 'unavailable';
      return { id: agency.id, name: agency.name, state, capabilities: agency.capabilities, lastSuccessfulFetch: Object.values(feeds).map(feed => feed.lastSuccessfulFetch).filter(Boolean).sort().at(-1), timestamp: checkedAt, feeds };
    }));
    return { agencies };
  }
}
