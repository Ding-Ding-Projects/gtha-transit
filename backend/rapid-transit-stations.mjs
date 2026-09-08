/**
 * Every rapid transit station in the system, derived from the published indexes.
 *
 * A subway speed run has to name every station, and a hand-typed list of them is
 * wrong the day a line opens. This derives the list from the same route pattern
 * index the planner uses, so it follows the feed.
 *
 * **Platforms are not stations, and this feed does not say which is which.** The
 * TTC publishes one stop per platform, so Line 1 arrives as 69 stops for its 38
 * stations. GTFS has a field for exactly this problem, `parent_station`, and the
 * TTC leaves it null on every one of them, so it cannot be used and the station
 * has to be read out of the platform's name.
 *
 * The rule is: everything up to and including the word "Station" is the station,
 * and what follows says which platform of it. Where a name has no "Station" in
 * it, the trailing platform descriptor is removed instead. That second case is
 * rare enough to be worth naming: on the whole network today it is York
 * University, which the feed calls "York University - Northbound Platform".
 *
 * The derivation is checked against the published station counts rather than
 * trusted: 38, 31, 5, 25 and 18 for lines 1, 2, 4, 5 and 6. A rule that produces
 * a different number is wrong even if it looks reasonable, and an earlier and
 * more general-looking version of this one produced 39, 33 and 7.
 */

/** Route identifiers for the lines a rapid transit run covers. */
export const RAPID_TRANSIT_ROUTES = ['ttc:1', 'ttc:2', 'ttc:4', 'ttc:5', 'ttc:6'];

/**
 * The published station count per line, as an assertion rather than a comment.
 *
 * These come from the operator's own published network, and they are here so a
 * change in the feed's naming shows up as a mismatch instead of as a speed run
 * that quietly asks for the wrong number of stations.
 */
export const EXPECTED_STATION_COUNTS = Object.freeze({
  'ttc:1': 38, 'ttc:2': 31, 'ttc:4': 5, 'ttc:5': 25, 'ttc:6': 18,
});

const PLATFORM_TAIL = /\s*[-–]?\s*\S*\s*Platform\b.*$/i;
const TRAILING_SEPARATOR = /\s*[-–]\s*$/;

/**
 * The station a platform belongs to.
 *
 * Exported because it is the whole derivation, and a rule this load-bearing
 * should be testable on its own rather than only through the list it produces.
 */
export function stationNameFromPlatform(name) {
  if (typeof name !== 'string' || !name.trim()) return null;
  const upToStation = /^(.*?\bStation)\b/.exec(name);
  if (upToStation) return upToStation[1].trim();
  return name.replace(PLATFORM_TAIL, '').replace(TRAILING_SEPARATOR, '').trim() || null;
}

const average = (values) => values.reduce((total, value) => total + value, 0) / values.length;

/**
 * Stations for the given routes, in the order the line serves them.
 *
 * Order comes from the longest pattern in each direction, which is the closest
 * thing the feed has to "the whole line": a short-turn pattern would otherwise
 * decide where a line starts.
 */
export function rapidTransitStationsFromIndexes(patterns, { routes = RAPID_TRANSIT_ROUTES } = {}) {
  const byRoute = patterns?.routePatterns ?? {};
  const lines = [];
  const stations = new Map();

  for (const routeId of routes) {
    const patternList = Array.isArray(byRoute[routeId]) ? byRoute[routeId] : [];
    if (!patternList.length) {
      lines.push({ routeId, stations: [], expected: EXPECTED_STATION_COUNTS[routeId] ?? null, matchesPublished: false, reason: 'route-not-in-index' });
      continue;
    }
    // The longest pattern covers the most of the line; short turns cover less.
    const longest = [...patternList].sort((first, second) => (second.stops?.length ?? 0) - (first.stops?.length ?? 0))[0];
    const ordered = [];
    const seen = new Set();
    for (const stop of longest.stops ?? []) {
      const station = stationNameFromPlatform(stop?.name);
      if (!station || seen.has(station)) continue;
      seen.add(station);
      ordered.push(station);
    }
    /* A station only served by a pattern other than the longest still belongs to
       the line; it is appended rather than dropped, because a speed run that
       omits a station is a speed run nobody can finish. */
    const everyStation = new Map();
    for (const pattern of patternList) {
      for (const stop of pattern.stops ?? []) {
        const station = stationNameFromPlatform(stop?.name);
        if (!station) continue;
        const at = everyStation.get(station) ?? { name: station, lats: [], lons: [] };
        if (Number.isFinite(stop.lat)) at.lats.push(stop.lat);
        if (Number.isFinite(stop.lon)) at.lons.push(stop.lon);
        everyStation.set(station, at);
      }
    }
    for (const station of everyStation.keys()) {
      if (!seen.has(station)) { seen.add(station); ordered.push(station); }
    }

    const withPlaces = ordered.map((name, index) => {
      const at = everyStation.get(name);
      return {
        name,
        sequence: index + 1,
        // The mean of a station's platforms, which is the station rather than one
        // side of it. Reported so a check-in can be measured against something.
        lat: at?.lats.length ? Number(average(at.lats).toFixed(6)) : null,
        lon: at?.lons.length ? Number(average(at.lons).toFixed(6)) : null,
      };
    });

    const expected = EXPECTED_STATION_COUNTS[routeId] ?? null;
    lines.push({
      routeId,
      stations: withPlaces,
      expected,
      matchesPublished: expected == null ? null : withPlaces.length === expected,
    });
    for (const station of withPlaces) {
      const existing = stations.get(station.name);
      if (existing) existing.routes.push(routeId);
      else stations.set(station.name, { name: station.name, lat: station.lat, lon: station.lon, routes: [routeId] });
    }
  }

  const mismatched = lines.filter((line) => line.matchesPublished === false).map((line) => line.routeId);
  return {
    schemaVersion: 1,
    source: 'route pattern index built from checksum-validated official GTFS archives',
    derivation: 'A platform name up to and including the word Station names the station. This feed leaves parent_station null on every rapid transit stop, so it cannot be used.',
    lines,
    stations: [...stations.values()],
    totalStations: stations.size,
    interchanges: [...stations.values()].filter((station) => station.routes.length > 1).map((station) => station.name),
    matchesPublished: mismatched.length === 0,
    mismatchedRoutes: mismatched,
  };
}
