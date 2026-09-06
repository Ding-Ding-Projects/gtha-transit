/**
 * A journey smoke test across Toronto and the wider region.
 *
 * It asks the deployed service the questions a rider actually asks: resolve a
 * place by name, then plan a real journey between two of them. Nothing is
 * mocked. A pair that returns no journey is reported as a failure with the
 * service's own reason, because "no route" and "the planner is down" look the
 * same to a rider and must not look the same here.
 *
 * Usage: node scripts/smoke-journeys.mjs [origin] [--json]
 *   origin defaults to https://toronto-transit.org
 */

const origin = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'https://toronto-transit.org').replace(/\/$/, '');
const asJson = process.argv.includes('--json');

/** Every pair carries the mode it is meant to exercise, so a gap is legible. */
const JOURNEYS = [
  { area: 'Toronto', exercises: 'subway east to west', from: 'Union Station', to: 'Kipling Station' },
  { area: 'Toronto', exercises: 'bus north from a subway terminal', from: 'Warden Station', to: 'Steeles Avenue East' },
  { area: 'Toronto', exercises: 'streetcar across downtown', from: 'Spadina Station', to: 'Distillery District' },
  { area: 'Toronto', exercises: 'airport rail link', from: 'Toronto Pearson', to: 'Union Station' },
  { area: 'Toronto', exercises: 'suburb to suburb across the city', from: 'Scarborough Centre', to: 'North York Centre' },
  { area: 'Toronto', exercises: 'east end to the west end', from: 'Main Street Station', to: 'Jane Station' },
  { area: 'Regional', exercises: 'Lakeshore West from Hamilton', from: 'Hamilton GO Centre', to: 'Union Station' },
  { area: 'Regional', exercises: 'Lakeshore East from Durham', from: 'Oshawa GO', to: 'Union Station' },
  { area: 'Regional', exercises: 'Mississauga city centre inbound', from: 'Square One', to: 'Union Station' },
  { area: 'Regional', exercises: 'Halton inbound', from: 'Burlington GO', to: 'Union Station' },
  { area: 'Regional', exercises: 'Peel on the Kitchener corridor', from: 'Bramalea GO', to: 'Union Station' },
  { area: 'Regional', exercises: 'Barrie corridor, long distance', from: 'Allandale Waterfront GO', to: 'Union Station' },
  { area: 'Regional', exercises: 'York Region inbound', from: 'Richmond Hill Centre', to: 'Union Station' },
  { area: 'Regional', exercises: 'region to region, not through downtown', from: 'Oakville GO', to: 'Pickering GO' },
];

const TIMEOUT_MS = 40_000;

async function resolvePlace(query) {
  const response = await fetch(`${origin}/api/places?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`place lookup ${response.status}`);
  const payload = await response.json();
  const places = payload.places || [];
  if (!places.length) throw new Error('no place matched');
  // Prefer a published transit stop over a bare place name; a rider searching a
  // station means the station.
  return places.find((place) => place.kind === 'stop' || place.stopId) || places[0];
}

const millis = (value) => (typeof value === 'number'
  ? (Math.abs(value) < 100_000_000_000 ? value * 1000 : value)
  : Date.parse(String(value)));

/** Two hours out, so the answer exercises a real timetable rather than the edge of service. */
function departureTime() {
  return new Date(Date.now() + 2 * 3600 * 1000).toISOString();
}

/**
 * A second, busier moment to ask again at.
 *
 * A corridor with a long evening or weekend gap genuinely has no journey at some
 * hours, and reporting that as a failure would be a false alarm about the service
 * rather than a fact about it. So a pair that finds nothing is asked again at the
 * next weekday mid-morning: an answer there means the timetable is loaded and the
 * first attempt simply landed in a gap.
 */
function busyWeekdayTime() {
  for (let days = 1; days <= 7; days += 1) {
    const candidate = new Date(Date.now() + days * 86400000);
    const weekday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', weekday: 'short' }).format(candidate);
    if (weekday === 'Sat' || weekday === 'Sun') continue;
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(candidate);
    const get = (type) => parts.find((part) => part.type === type)?.value;
    const noonUtc = Date.parse(get('year') + '-' + get('month') + '-' + get('day') + 'T12:00:00Z');
    const shownHour = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: '2-digit', hour12: false }).format(new Date(noonUtc)));
    return new Date(noonUtc + (9 - shownHour) * 3600000).toISOString();
  }
  return new Date(Date.now()).toISOString();
}

async function plan(from, to, dateTime) {
  const response = await fetch(`${origin}/api/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      from: { id: from.id, name: from.name, lat: from.lat, lon: from.lon },
      to: { id: to.id, name: to.name, lat: to.lat, lon: to.lon },
      via: [], dateTime, arriveBy: false, preference: 'fastest', wheelchair: false, maxWalkDistance: 2000,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `plan ${response.status}`);
  return payload;
}

const results = [];
const iso = departureTime();
const fallbackIso = busyWeekdayTime();

for (const journey of JOURNEYS) {
  const started = Date.now();
  const row = { ...journey, state: 'failed' };
  try {
    const [from, to] = await Promise.all([resolvePlace(journey.from), resolvePlace(journey.to)]);
    row.resolvedFrom = from.name;
    row.resolvedTo = to.name;
    const payload = await plan(from, to, iso);
    const itineraries = payload.itineraries || [];
    row.itineraries = itineraries.length;
    if (!itineraries.length) {
      // Ask again in the weekday peak before calling it broken.
      const retry = await plan(from, to, fallbackIso).catch(() => ({ itineraries: [] }));
      if ((retry.itineraries || []).length) {
        row.state = 'service-gap';
        row.itineraries = 0;
        row.reason = 'no departure at this hour; ' + retry.itineraries.length + ' found at ' + fallbackIso;
      } else {
        row.reason = payload.coverage ? 'no journey, coverage reported' : 'no journey returned';
      }
    } else {
      const best = itineraries[0];
      const transit = (best.legs || []).filter((leg) => leg.mode !== 'WALK');
      row.state = 'ok';
      row.minutes = Math.round((millis(best.endTime) - millis(best.startTime)) / 60000);
      row.legs = transit.map((leg) => `${leg.agency || '?'} ${leg.route || leg.mode}`).join(' > ') || 'walking only';
      row.agencies = [...new Set(transit.map((leg) => leg.agency).filter(Boolean))];
      row.transfers = Math.max(0, transit.length - 1);
      row.vehicleStates = [...new Set(transit.map((leg) => leg.vehicleAssignment?.state).filter(Boolean))];
      row.blockChains = transit.filter((leg) => leg.blockChain?.previousTripId).length;
    }
  } catch (cause) {
    row.reason = cause instanceof Error ? cause.message : String(cause);
  }
  row.millis = Date.now() - started;
  results.push(row);
}

const passed = results.filter((row) => row.state === 'ok');
const gaps = results.filter((row) => row.state === 'service-gap');
const failed = results.filter((row) => row.state === 'failed');
const agencies = [...new Set(passed.flatMap((row) => row.agencies || []))].sort();

if (asJson) {
  console.log(JSON.stringify({ origin, departure: iso, fallbackDeparture: fallbackIso, results, passed: passed.length, serviceGaps: gaps.length, failed: failed.length, total: results.length, agencies }, null, 2));
} else {
  console.log(`Journey smoke test against ${origin}, departing ${iso}\n`);
  for (const row of results) {
    const mark = row.state === 'ok' ? 'ok  ' : row.state === 'service-gap' ? 'gap ' : 'FAIL';
    const detail = row.state === 'ok'
      ? `${String(row.minutes).padStart(3)} min  ${row.itineraries} options  ${row.legs}`
      : `${row.reason}`;
    console.log(`${mark} ${row.area.padEnd(8)} ${(row.from + ' -> ' + row.to).padEnd(46)} ${detail}`);
  }
  console.log(`\n${passed.length}/${results.length} planned, ${gaps.length} with no departure at this hour, ${failed.length} failed`);
  console.log(`agencies reached: ${agencies.join(', ') || 'none'}`);
  const chains = passed.reduce((total, row) => total + (row.blockChains || 0), 0);
  console.log(`legs carrying a block chain: ${chains}`);
}

// A real timetable gap is a fact about the service, not a broken planner.
process.exitCode = failed.length === 0 ? 0 : 1;
