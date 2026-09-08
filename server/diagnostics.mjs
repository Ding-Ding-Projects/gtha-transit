/**
 * A bounded record of what has recently gone wrong, readable over HTTP.
 *
 * The frontend runs in a container behind a tunnel. When something fails there,
 * the evidence is in a log nobody is watching, on a host nobody is logged into,
 * and the failure is found by a person trying to plan a journey. That has
 * happened here before: a routing container exited and stayed down for six hours
 * while the frontend reported itself perfectly healthy.
 *
 * `/api/dependencies` answers whether the private origins are up right now. This
 * answers the different question of what has been failing, which a single probe
 * cannot: an origin that fails one request in ten looks available every time you
 * ask it.
 *
 * **What is deliberately not recorded.** No IP address, no user agent, no cookie,
 * no query string, no request or response body, no place name, no coordinate. A
 * journey planner's query string is where someone lives and where they are going;
 * a diagnostics buffer is the last place that belongs. What is kept is the route
 * pattern, the kind of failure, a bounded message, and a duration. That is enough
 * to find a broken deploy and not enough to follow anybody home.
 *
 * The buffer is in memory and dies with the process, on purpose. It is for
 * looking at a running deployment, not a record anybody should build on.
 */

/** Small enough to stay cheap, large enough to show a pattern rather than one event. */
const CAPACITY = 200;
const MAX_MESSAGE = 240;
const MAX_ROUTE = 120;

/** Kinds a caller may record. An unknown kind is recorded as unknown, never dropped. */
const KINDS = new Set(['upstream', 'request', 'client', 'startup']);

const entries = [];
let sequence = 0;
let dropped = 0;

/** Text with control characters and anything oversized removed. */
function boundedText(value, limit) {
  if (value == null) return null;
  // \p{Cc} is the Unicode control category. It says what is meant without a
  // literal control character in the source, and without splitting the string
  // into code points, which would take an emoji apart.
  const text = String(value).replace(/\p{Cc}/gu, ' ').trim();
  return text ? text.slice(0, limit) : null;
}

/**
 * A route with its variable parts removed.
 *
 * `/api/vehicle-photo?id=8432` becomes `/api/vehicle-photo`. Query strings never
 * survive, and a path segment that looks like an identifier is replaced, so a
 * stop id or a vehicle number cannot arrive here by way of a path.
 */
export function routePattern(value) {
  const text = boundedText(value, MAX_ROUTE);
  if (!text) return null;
  const withoutQuery = text.split('?')[0].split('#')[0];
  return withoutQuery
    .split('/')
    // All digits, or a long hex string, is an identifier rather than a route.
    .map((segment) => (/^[0-9]+$/.test(segment) || /^[0-9a-f]{8,}$/i.test(segment) ? ':id' : segment))
    .join('/')
    .slice(0, MAX_ROUTE);
}

/**
 * Record one failure.
 *
 * Never throws. A diagnostics buffer that can break the request it is describing
 * is worse than no diagnostics: the first thing it would break is the error path.
 */
export function record(failure) {
  try {
    /* Read inside the try, not in the parameter list. A default parameter only
       covers undefined, so destructuring `null` there throws before the try can
       catch it, and the one caller who would pass null is an error handler. */
    const { kind, route, status, message, millis } = failure ?? {};
    sequence += 1;
    if (entries.length >= CAPACITY) {
      entries.shift();
      dropped += 1;
    }
    entries.push({
      sequence,
      at: new Date().toISOString(),
      kind: KINDS.has(kind) ? kind : 'unknown',
      route: routePattern(route),
      status: Number.isFinite(Number(status)) ? Number(status) : null,
      message: boundedText(message, MAX_MESSAGE),
      millis: Number.isFinite(Number(millis)) ? Math.round(Number(millis)) : null,
    });
  } catch {
    // Deliberately silent. See above.
  }
}

/** What has failed recently, newest first, with a count of what fell off the end. */
export function recent(limit = CAPACITY) {
  const wanted = Math.max(1, Math.min(CAPACITY, Number(limit) || CAPACITY));
  const rows = entries.slice(-wanted).reverse();
  const byKind = {};
  const byRoute = {};
  for (const entry of entries) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
    if (entry.route) byRoute[entry.route] = (byRoute[entry.route] ?? 0) + 1;
  }
  return {
    service: 'gtha-transit-web',
    checkedAt: new Date().toISOString(),
    capacity: CAPACITY,
    recorded: sequence,
    retained: entries.length,
    dropped,
    byKind,
    byRoute,
    entries: rows,
    note: 'In-memory and lost on restart. No addresses, agents, queries or bodies are recorded.',
  };
}

/** Only for tests: start from nothing. */
export function reset() {
  entries.length = 0;
  sequence = 0;
  dropped = 0;
}
