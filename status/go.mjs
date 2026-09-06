import { parseAlertFeed } from './ttc.mjs';

/**
 * GO Transit and UP Express service alerts.
 *
 * Metrolinx publishes these as an ordinary GTFS-Realtime alert feed behind an
 * API key, so the routing service proxies it and this module reads what comes
 * back with the same decoder the TTC feed uses. Only the alerts are taken: the
 * line summary in that decoder's result is a TTC shape and means nothing here.
 */

export const METROLINX_AGENCIES = Object.freeze({
  go: { name: 'GO Transit', publisher: 'https://www.gotransit.com/en/service-updates' },
  up: { name: 'UP Express', publisher: 'https://www.upexpress.com/en/service-updates' },
});

const MAX_BYTES = 10 * 1024 * 1024;
const CACHE_MS = 30_000;
const cache = new Map();

const unavailable = (agency, fetchedAt, reason) => ({
  state: 'unavailable',
  agency,
  agencyName: METROLINX_AGENCIES[agency]?.name ?? agency,
  fetchedAt,
  sourceUrl: METROLINX_AGENCIES[agency]?.publisher ?? '',
  alerts: [],
  reason,
});

/**
 * Fetch and decode one agency's alerts.
 *
 * The routing service is the only route to this feed, because the API key lives
 * there and never reaches a browser. Without it configured there is no feed, and
 * that is reported as unavailable rather than as an absence of disruption.
 */
export async function getMetrolinxAlerts({
  agency = 'go',
  routingOrigin,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  timeoutMs = 8_000,
} = {}) {
  const fetchedAt = new Date(now).toISOString();
  if (!METROLINX_AGENCIES[agency]) return unavailable(agency, fetchedAt, 'Unknown agency.');
  const origin = String(routingOrigin ?? '').replace(/\/$/, '');
  if (!origin) return unavailable(agency, fetchedAt, 'These alerts require the configured routing service.');
  const cached = cache.get(agency);
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  try {
    const response = await fetchImpl(`${origin}/api/alerts/metrolinx?agency=${encodeURIComponent(agency)}`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    if (!response.ok) return unavailable(agency, fetchedAt, 'The alert feed refused this request.');
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) return unavailable(agency, fetchedAt, 'The alert payload exceeds the safety bound.');
    const parsed = parseAlertFeed(new Uint8Array(buffer), { fetchedAt, now });
    const value = {
      state: parsed.state,
      agency,
      agencyName: METROLINX_AGENCIES[agency].name,
      fetchedAt,
      sourceUpdatedAt: parsed.sourceUpdatedAt,
      sourceUrl: METROLINX_AGENCIES[agency].publisher,
      alerts: parsed.alerts,
    };
    cache.set(agency, { at: now, value });
    return value;
  } catch (cause) {
    return unavailable(agency, fetchedAt, cause instanceof Error && cause.name === 'TimeoutError'
      ? 'The alert feed did not answer in time.'
      : 'The alert feed could not be read.');
  }
}

export function clearMetrolinxAlertCache() { cache.clear(); }
