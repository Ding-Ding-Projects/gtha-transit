import http from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTtcStatus } from '../status/ttc.mjs';
import { createHistoryStore } from '../history/store.mjs';
import { createVehicleSightingStore } from '../history/vehicle-sightings.mjs';
import { loadRegistry, RealtimeAggregator } from '../realtime/aggregator.mjs';
import { getVehicles, enrichItineraries } from '../vehicles/index.mjs';
import { classifyOutOfDivision, loadTtcDivisionRegistry } from '../vehicles/divisions.mjs';
import { VERIFIED_PHOTO_URLS } from '../vehicles/fleet-registry.mjs';
const photoCache = new Map();
const realtime = new RealtimeAggregator({ registry: await loadRegistry() });
const history = process.env.HISTORY_DIR
  ? createHistoryStore({ directory: process.env.HISTORY_DIR })
  : null;
const vehicleSightings = process.env.HISTORY_DIR
  ? createVehicleSightingStore({ directory: process.env.HISTORY_DIR })
  : null;
const divisionRegistry = await loadTtcDivisionRegistry();
let collecting = false;
async function collect() {
  if (!history || collecting) return;
  collecting = true;
  try {
    history.observe(await getTtcStatus());
  } catch {
    console.error(
      'Disruption history collection failed; existing records retained.',
    );
  } finally {
    collecting = false;
  }
}
if (history) {
  void collect();
  setInterval(() => void collect(), 60000).unref();
}
let vehicleCollecting = false;
async function allTtcVehicles() {
  const vehicles = [];
  let cursor = '0';
  let snapshot;
  for (let pageNumber = 0; pageNumber < 4; pageNumber += 1) {
    const page = await getVehicles({ agency: 'ttc', limit: 2500, cursor, fixturePath: process.env.VEHICLE_FIXTURE_PATH || undefined });
    snapshot ??= page;
    vehicles.push(...page.vehicles);
    if (!page.nextCursor) return { ...page, vehicles, loaded: vehicles.length };
    cursor = page.nextCursor;
  }
  return { ...snapshot, vehicles, loaded: vehicles.length, nextCursor: cursor };
}
async function collectVehicleSightings() {
  if (!vehicleSightings || vehicleCollecting) return;
  vehicleCollecting = true;
  try {
    vehicleSightings.observe(await allTtcVehicles());
  } catch {
    console.error('Vehicle sighting collection failed; existing records retained.');
  } finally {
    vehicleCollecting = false;
  }
}
if (vehicleSightings) {
  void collectVehicleSightings();
  setInterval(() => void collectVehicleSightings(), 60000).unref();
}
function vehicleMatches(vehicle, query, route) {
  if (route && vehicle.routeId !== route) return false;
  if (!query) return true;
  return [vehicle.id, vehicle.label, vehicle.routeId, vehicle.cptdb?.manufacturer, vehicle.cptdb?.model, vehicle.cptdb?.year]
    .some((value) => String(value ?? '').toLocaleLowerCase().includes(query));
}
async function divisionPage(params) {
  const requestedState = params.get('classification') || 'all';
  if (!['all', 'out-of-division', 'in-division', 'unknown'].includes(requestedState)) throw Error('Invalid division classification.');
  const query = String(params.get('q') ?? '').trim().slice(0, 256).toLocaleLowerCase();
  const route = String(params.get('route') ?? '').replace(/^ttc:/i, '').trim().slice(0, 64);
  const requestedLimit = Number.parseInt(params.get('limit') ?? '100', 10);
  const limit = Math.min(2500, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 100));
  const requestedCursor = Number.parseInt(params.get('cursor') ?? '0', 10);
  const cursor = Number.isSafeInteger(requestedCursor) && requestedCursor >= 0 ? requestedCursor : 0;
  const snapshot = await allTtcVehicles();
  const now = Date.now();
  const classified = snapshot.vehicles.map((vehicle) => {
    const classification = classifyOutOfDivision(vehicle, vehicle.routeId, divisionRegistry, { now });
    const rarity = vehicleSightings && vehicle.routeId
      ? { state: 'available', ...vehicleSightings.query({ vehicleId: vehicle.id, routeId: vehicle.routeId, now }) }
      : { state: 'unavailable', reason: vehicleSightings ? 'route-identifier-unavailable' : 'history-storage-unavailable' };
    return {
      ...vehicle,
      division: {
        ...classification,
        routeGarages: classification.assignedGarages ?? [],
        rarity,
      },
    };
  });
  const counts = {
    all: classified.length,
    outOfDivision: classified.filter((vehicle) => vehicle.division.state === 'out-of-division').length,
    inDivision: classified.filter((vehicle) => vehicle.division.state === 'in-division').length,
    unknown: classified.filter((vehicle) => vehicle.division.state === 'unknown').length,
  };
  const filtered = classified.filter((vehicle) => vehicleMatches(vehicle, query, route) && (requestedState === 'all' || vehicle.division.state === requestedState));
  const vehicles = filtered.slice(cursor, cursor + limit);
  return {
    state: snapshot.state,
    agencyId: 'ttc',
    fetchedAt: snapshot.fetchedAt,
    sourceTimestamp: snapshot.sourceTimestamp,
    sourceUrl: snapshot.sourceUrl,
    source: divisionRegistry.source,
    loaded: snapshot.loaded,
    total: filtered.length,
    counts,
    vehicles,
    nextCursor: cursor + vehicles.length < filtered.length ? String(cursor + vehicles.length) : null,
  };
}
function historyPage(params) {
  const page = history.query(Object.fromEntries(params));
  return {
    records: page.items.map((row) => ({
      ...row.payload,
      id: String(row.occurrenceId),
      alertId: row.alertId,
      firstSeen: row.firstSeen,
      lastSeen: row.lastSeen,
      status: row.status,
      versionCount: row.versionCount,
    })),
    nextCursor: page.nextCursor,
  };
}
const root = path.resolve(
  process.env.STATIC_ROOT ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist/client'),
);
const routing = process.env.ROUTING_ORIGIN || 'http://127.0.0.1:8787';
const maps = process.env.MAPS_ORIGIN || 'http://127.0.0.1:8789';
const routes = new Set([
  '/api/stop-routes',
  '/api/plan-washroom-detour',
  '/api/routes',
  '/api/places',
  '/api/coverage',
  '/api/plan',
  '/api/departures',
  '/api/integrations/status',
]);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.rsc': 'text/x-component',
};
const send = (res, code, payload) => {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
};
async function body(req) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 32768) throw Error('Request is too large.');
    parts.push(part);
  }
  return Buffer.concat(parts);
}
async function bounded(res, max = 4 * 1024 * 1024) {
  const parts = [];
  let size = 0;
  for await (const part of res.body) {
    size += part.length;
    if (size > max) throw Error('Response limit exceeded');
    parts.push(part);
  }
  return Buffer.concat(parts);
}
const buckets = new Map();
function allowed(key) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.at > 60000) {
    b = { at: now, n: 0 };
    buckets.set(key, b);
  }
  if (buckets.size > 10000) {
    for (const [k, v] of buckets) if (now - v.at > 60000) buckets.delete(k);
    if (buckets.size > 10000) return false;
  }
  return ++b.n <= 120;
}
const placeIgnoredTerms = new Set(['and', 'at', 'the']);
const placeAliases = new Map([
  ['avenue', 'ave'], ['av', 'ave'], ['road', 'rd'], ['street', 'st'],
  ['boulevard', 'blvd'], ['drive', 'dr'], ['lane', 'ln'], ['court', 'ct'],
  ['parkway', 'pkwy'], ['highway', 'hwy'], ['saint', 'st'],
]);
const placeHighwayForms = new Set(['hwy', 'highway']);
const placeSaintForms = new Set(['st', 'saint', 'street']);
const placeHubTerms = new Set(['station', 'terminal', 'airport', 'centre', 'center']);

function placeTerms(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z]{2,})/g, '$1 $2')
    .trim()
    .split(' ')
    .filter((term) => term && !placeIgnoredTerms.has(term))
    .map((term) => placeAliases.get(term) ?? term);
}
function placeNumeric(term) { return /^\d+$/.test(term); }
function placeHighwayContext(terms, index) {
  return placeNumeric(terms[index - 1] ?? '') || placeNumeric(terms[index + 1] ?? '');
}
function placeTermForms(terms, index) {
  const term = terms[index];
  const forms = new Set([term]);
  if (placeHighwayForms.has(term)) for (const form of placeHighwayForms) forms.add(form);
  if (placeSaintForms.has(term)) for (const form of placeSaintForms) forms.add(form);
  if ((term === 'high' || term === 'route') && placeHighwayContext(terms, index)) forms.add('hwy');
  return forms;
}
function placeTermStrength(queryTerms, queryIndex, candidateTerms, candidateIndex) {
  const queryTerm = queryTerms[queryIndex];
  const queryForms = placeTermForms(queryTerms, queryIndex);
  const candidateForms = placeTermForms(candidateTerms, candidateIndex);
  if ([...queryForms].some((form) => candidateForms.has(form))) return 0;
  if (!placeNumeric(queryTerm) && queryTerm !== 'st' && queryTerm.length >= 2 && [...candidateForms].some((form) => form.startsWith(queryTerm))) return 1;
  return null;
}
function placeBestTermMatch(queryTerms, queryIndex, candidateTerms) {
  let best = null;
  for (let candidateIndex = 0; candidateIndex < candidateTerms.length; candidateIndex += 1) {
    const quality = placeTermStrength(queryTerms, queryIndex, candidateTerms, candidateIndex);
    if (quality !== null && (!best || quality < best.quality || (quality === best.quality && candidateIndex < best.index))) best = { quality, index: candidateIndex };
  }
  return best;
}
function placeExactPhraseIndex(queryTerms, candidateTerms) {
  for (let start = 0; start <= candidateTerms.length - queryTerms.length; start += 1) {
    if (queryTerms.every((_, index) => placeTermStrength(queryTerms, index, candidateTerms, start + index) === 0)) return start;
  }
  return -1;
}
function placeRank(place, queryTerms) {
  const nameTerms = placeTerms(place.name);
  const matches = queryTerms.map((_, index) => placeBestTermMatch(queryTerms, index, nameTerms));
  const allNameTermsMatch = matches.every(Boolean);
  const allNameTermsExact = allNameTermsMatch && matches.every((match) => match.quality === 0);
  const exact = allNameTermsExact && nameTerms.length === queryTerms.length;
  const forwardPhrase = allNameTermsExact ? placeExactPhraseIndex(queryTerms, nameTerms) : -1;
  const reversePhrase = allNameTermsExact ? placeExactPhraseIndex([...queryTerms].reverse(), nameTerms) : -1;
  const phrasePositions = [forwardPhrase, reversePhrase].filter((index) => index >= 0);
  const phraseIndex = phrasePositions.length ? Math.min(...phrasePositions) : 999;
  const hub = nameTerms.some((term) => placeHubTerms.has(term));
  const kind = String(place.kind ?? '').toLocaleLowerCase();
  const tier = exact ? 0 : allNameTermsExact && hub ? 1 : allNameTermsExact && kind === 'intersection' ? 2 : allNameTermsExact && phrasePositions.length ? 3 : allNameTermsExact ? 4 : allNameTermsMatch && kind === 'intersection' ? 5 : 6;
  const prefixCount = matches.filter((match) => match?.quality === 1).length;
  return [tier, prefixCount, phraseIndex, nameTerms.length, nameTerms.join(' '), String(place.id ?? '')];
}
function comparePlaceRanks(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    const value = typeof left[index] === 'number' ? left[index] - right[index] : String(left[index]).localeCompare(String(right[index]));
    if (value) return value;
  }
  return 0;
}
function mergedPlaces(stops, mapPlaces, query) {
  const queryTerms = placeTerms(query);
  const ranked = [...stops, ...mapPlaces]
    .filter((place) => place && typeof place === 'object')
    .map((place) => ({ place, rank: placeRank(place, queryTerms) }))
    .sort((left, right) => comparePlaceRanks(left.rank, right.rank));
  const ids = new Set();
  const locations = new Set();
  return ranked.filter(({ place }) => {
    const id = place.id == null ? '' : String(place.id);
    if (id && ids.has(id)) return false;
    const lat = Number(place.lat); const lon = Number(place.lon);
    const hasLocation = place.lat != null && place.lon != null && Number.isFinite(lat) && Number.isFinite(lon);
    const location = hasLocation ? `${placeTerms(place.name).join(' ')}|${placeTerms(place.agency).join(' ')}|${lat}|${lon}` : null;
    if (location && locations.has(location)) return false;
    if (id) ids.add(id);
    if (location) locations.add(location);
    return true;
  }).slice(0, 25).map(({ place }) => place);
}
async function placeSource(origin, requestPath, field) {
  try {
    const response = await fetch(origin + requestPath, {
      signal: AbortSignal.timeout(2500),
      redirect: 'error',
    });
    if (!response.ok) return { available: false, places: [] };
    const payload = JSON.parse((await bounded(response, 2 * 1024 * 1024)).toString('utf8'));
    const places = field === 'map' ? payload.results ?? payload.places : payload.places;
    return { available: Array.isArray(places), places: Array.isArray(places) ? places.slice(0, 20) : [] };
  } catch {
    return { available: false, places: [] };
  }
}

let activeRequests = 0;
const server = http.createServer(async (req, res) => {
  if (activeRequests >= 16)
    return send(res, 503, {
      error: 'The service is busy. Please retry shortly.',
    });
  activeRequests++;
  res.once('close', () => {
    activeRequests--;
  });
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader(
    'permissions-policy',
    'camera=(), microphone=(), geolocation=(self)',
  );
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/vehicle-photo' && req.method === 'GET') {
      const source = url.searchParams.get('source');
      if (!VERIFIED_PHOTO_URLS.includes(source))
        return send(res, 404, { error: 'Photo not registered.' });
      let photo = photoCache.get(source);
      if (!photo) {
        const upstream = await fetch(source, {
          signal: AbortSignal.timeout(12000),
          redirect: 'error',
          headers: {
            'user-agent': 'GTHATransit/0.1 (https://toronto-transit.org)',
          },
        });
        if (!upstream.ok)
          return send(res, 502, { error: 'Photo source unavailable.' });
        const bytes = await bounded(upstream, 10 * 1024 * 1024);
        if (!(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255))
          return send(res, 502, {
            error: 'Photo format could not be verified.',
          });
        photo = { bytes, type: 'image/jpeg' };
        if (bytes.length <= 2 * 1024 * 1024) {
          if (photoCache.size >= 8)
            photoCache.delete(photoCache.keys().next().value);
          photoCache.set(source, photo);
        }
      }
      res.writeHead(200, {
        'content-type': photo.type,
        'cache-control': 'public,max-age=86400',
      });
      return res.end(photo.bytes);
    }
    if (url.pathname === '/setup/metrolinx')
      return send(res, 410, {
        message: 'The one-time integration setup is closed.',
      });
    if (url.pathname === '/api/vehicles' && req.method === 'GET')
      return send(
        res,
        200,
        await getVehicles(Object.fromEntries(url.searchParams)),
      );
    if (url.pathname === '/api/vehicles/divisions' && req.method === 'GET') {
      try {
        return send(res, 200, await divisionPage(url.searchParams));
      } catch (error) {
        return send(res, 400, { error: error.message });
      }
    }
    if (url.pathname === '/api/realtime' && req.method === 'GET') {
      const summary = await realtime.refresh();
      try {
        const r = await fetch(routing + '/api/integrations/status', {
          signal: AbortSignal.timeout(3000),
          redirect: 'error',
        });
        if (r.ok) {
          const d = JSON.parse(await bounded(r, 65536));
          for (const live of d.metrolinx?.agencies || []) {
            const a = summary.agencies.find((x) => x.id === live.id);
            if (a) {
              a.state = live.state;
              if (live.lastSuccessfulFetch)
                a.lastSuccessfulFetch = live.lastSuccessfulFetch;
              for (const field of ['tripUpdates', 'serviceAlerts'])
                if (live.state === 'live' || live.state === 'partial')
                  a.capabilities[field] = 'configured';
              a.integration = live;
            }
          }
        }
      } catch {}
      return send(res, 200, summary);
    }
    if (url.pathname.startsWith('/api/history') && req.method === 'GET') {
      if (!history)
        return send(res, 503, { error: 'History storage is unavailable.' });
      if (url.pathname === '/api/history/export') {
        res.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'content-disposition':
            'attachment; filename="ttc-disruption-history.ndjson"',
          'cache-control': 'no-store',
        });
        const params = new URLSearchParams(url.searchParams);
        params.set('limit', '100');
        params.delete('cursor');
        let cursor = null;
        do {
          if (res.destroyed) return;
          if (cursor) params.set('cursor', cursor);
          const page = historyPage(params);
          for (const row of page.records) {
            if (!res.write(JSON.stringify(row) + '\n'))
              await new Promise((resolve) => {
                res.once('drain', resolve);
                res.once('close', resolve);
              });
          }
          cursor = page.nextCursor;
        } while (cursor);
        return res.end();
      }
      if (url.pathname === '/api/history') {
        try {
          return send(res, 200, historyPage(url.searchParams));
        } catch {
          return send(res, 400, {
            error: 'Invalid history date range or filter.',
          });
        }
      }
    }
    if (req.url.length > 4096)
      return send(res, 414, { error: 'Request URL is too long.' });
    if (url.pathname === '/health')
      return send(res, 200, { ok: true, service: 'gtha-transit-web' });
    if (url.pathname === '/api/status/ttc' && req.method === 'GET')
      return send(res, 200, await getTtcStatus());
    if (routes.has(url.pathname)) {
      if (
        !allowed(
          process.env.TRUST_TUNNEL === '1'
            ? String(
                req.headers['cf-connecting-ip'] || req.socket.remoteAddress,
              ).slice(0, 80)
            : req.socket.remoteAddress,
        )
      )
        return send(res, 429, {
          error: 'Too many searches. Please wait a minute.',
        });
      if (
        (['/api/plan', '/api/plan-washroom-detour'].includes(url.pathname) && req.method !== 'POST') ||
        (!['/api/plan', '/api/plan-washroom-detour'].includes(url.pathname) && req.method !== 'GET')
      )
        return send(res, 405, { error: 'Method not allowed.' });
      if (url.pathname === '/api/places') {
        const [routingPlaces, mapPlaces] = await Promise.all([
          placeSource(routing, '/api/places' + url.search, 'routing'),
          placeSource(maps, '/search' + url.search, 'map'),
        ]);
        if (!routingPlaces.available && !mapPlaces.available)
          return send(res, 503, { error: 'Place search is temporarily unavailable.', sources: { routing: 'unavailable', maps: 'unavailable' } });
        return send(res, 200, {
          places: mergedPlaces(routingPlaces.places, mapPlaces.places, url.searchParams.get('q')),
          partial: !routingPlaces.available || !mapPlaces.available,
          sources: {
            routing: routingPlaces.available ? 'available' : 'unavailable',
            maps: mapPlaces.available ? 'available' : 'unavailable',
          },
        });
      }
      const input = req.method === 'POST' ? await body(req) : undefined;
      let extendedPlanning = url.pathname === '/api/plan-washroom-detour';
      if (url.pathname === '/api/plan' && input) {
        try { extendedPlanning = JSON.parse(input.toString('utf8')).requiredRoute != null; } catch { /* The backend reports invalid request syntax. */ }
      }
      const upstream = await fetch(routing + url.pathname + url.search, {
        method: req.method,
        headers: { 'content-type': 'application/json' },
        body: input,
        signal: AbortSignal.timeout(extendedPlanning ? 28000 : 23000),
        redirect: 'error',
      });
      let payload = await bounded(upstream);
      if (!upstream.ok) {
        let detail;
        try {
          detail = JSON.parse(payload);
        } catch {}
        if (detail?.code === 'MULTI_STOP_INCOMPLETE' || detail?.code === 'REQUIRED_LINE_UNRESOLVED') return send(res, 422, {
          code: detail.code,
          error: detail.code === 'MULTI_STOP_INCOMPLETE' ? 'No complete journey connecting every destination in order was found.' : 'No complete journey riding the selected line was found in this bounded search.',
          failedSegment: detail.failedSegment ?? null,
          requiredLine: detail.requiredLine ?? null,
        });
        if (detail?.code === 'SCHEDULE_DATE_UNAVAILABLE')
          return send(res, 409, {
            code: detail.code,
            error:
              'The loaded TTC schedule has no trips for your selected date. This is a schedule-data gap, not a closure notice.',
            nextServiceDate: /^\d{4}-\d{2}-\d{2}$/.test(
              detail.nextServiceDate || '',
            )
              ? detail.nextServiceDate
              : null,
          });
        return send(res, upstream.status >= 500 ? 503 : upstream.status, {
          error:
            upstream.status >= 500
              ? 'Regional routing is temporarily unavailable. Please try again shortly.'
              : 'The journey request could not be completed. Check the locations, date and preferences.',
        });
      }
      if (url.pathname === '/api/plan') {
        try {
          const plan = JSON.parse(payload);
          payload = Buffer.from(
            JSON.stringify(
              await enrichItineraries(plan, {
                routingOrigin: routing,
                timeoutMs: 4000,
              }),
            ),
          );
        } catch {
          /* A missing vehicle assignment must not discard an otherwise valid journey. */
        }
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      return res.end(payload);
    }
    if (url.pathname === '/api/map-info' && req.method === 'GET') {
      const upstream = await fetch(maps + '/map-info', {
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!upstream.ok)
        return send(res, 503, { error: 'Map revision unavailable.' });
      const info = JSON.parse((await bounded(upstream, 4096)).toString('utf8'));
      if (!/^[a-f0-9]{64}$/.test(info.revision ?? ''))
        return send(res, 503, { error: 'Map revision unavailable.' });
      return send(res, 200, {
        revision: info.revision,
        minZoom: 8,
        maxZoom: 13,
      });
    }
    if (
      /^\/tiles\/(?:[a-f0-9]{64}\/)?\d{1,2}\/\d+\/\d+\.png$/.test(
        url.pathname,
      ) &&
      req.method === 'GET'
    ) {
      const upstream = await fetch(maps + url.pathname, {
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!upstream.ok)
        return send(res, 404, { error: 'Map tile unavailable.' });
      const bytes = await bounded(upstream, 1024 * 1024);
      res.writeHead(200, {
        'content-type': 'image/png',
        'cache-control': /^\/tiles\/[a-f0-9]{64}\//.test(url.pathname)
          ? 'public,max-age=86400,immutable'
          : 'no-cache',
      });
      return res.end(bytes);
    }
    if (!['GET', 'HEAD'].includes(req.method))
      return send(res, 405, { error: 'Method not allowed.' });
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.includes('\0') || decoded.includes('\\'))
      return send(res, 400, { error: 'Invalid path.' });
    const target = path.resolve(
      root,
      '.' + (decoded === '/' ? '/index.html' : decoded),
    );
    if (target !== root && !target.startsWith(root + path.sep))
      return send(res, 403, { error: 'Path not allowed.' });
    const info = await stat(target);
    if (!info.isFile()) return send(res, 404, { error: 'Not found.' });
    res.writeHead(200, {
      'content-type': mime[path.extname(target)] || 'application/octet-stream',
      'content-length': info.size,
      'cache-control': path.extname(target) === '.html'
        ? 'public,no-cache,no-transform'
        : target.includes('/_next/')
        ? 'public,max-age=31536000,immutable'
        : 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(target).pipe(res);
  } catch (e) {
    if (!res.headersSent)
      send(res, e?.code === 'ENOENT' ? 404 : 503, {
        error:
          e?.code === 'ENOENT'
            ? 'Not found.'
            : 'This service is temporarily unavailable. Please try again.',
      });
    else res.destroy();
  }
});
server.requestTimeout = 30000;
server.maxConnections = 128;
server.headersTimeout = 10000;
server.listen(
  Number(process.env.PORT || 8080),
  process.env.HOST || '0.0.0.0',
  () => console.log('GTHA Transit web service ready'),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
