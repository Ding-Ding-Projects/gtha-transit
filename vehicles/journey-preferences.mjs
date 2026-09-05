/**
 * Pure vehicle-preference evaluation for already assigned journey legs.
 * This module deliberately never infers a vehicle from a route, trip, or agency.
 */

const WALKING_MODES = new Set(['WALK', 'WALKING']);
const isPresent = (value) => value !== undefined && value !== null && String(value).trim() !== '';
const normalise = (value) => String(value).normalize('NFKC').trim().toLocaleLowerCase();
const MIN_YEAR = 1800;
const MAX_YEAR = 3000;

function requestedYear(value, field, validationErrors) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return null;
  const validType = typeof value === 'number' || (typeof value === 'string' && /^[0-9]{4}$/.test(value.trim()));
  const year = validType ? Number(value) : NaN;
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    validationErrors.push({ field, reason: 'Enter a whole year from 1800 through 3000.' });
    return null;
  }
  return year;
}

function requestedCriteria(criteria = {}) {
  const manufacturer = isPresent(criteria.manufacturer) ? normalise(criteria.manufacturer) : null;
  const model = isPresent(criteria.model) ? normalise(criteria.model) : null;
  const validationErrors = [];
  const yearFrom = requestedYear(criteria.yearFrom, 'yearFrom', validationErrors);
  const yearTo = requestedYear(criteria.yearTo, 'yearTo', validationErrors);
  const range = yearFrom !== null || yearTo !== null
    ? { from: yearFrom ?? MIN_YEAR, to: yearTo ?? MAX_YEAR }
    : null;
  if (range && range.from > range.to) validationErrors.push({ field: 'year', reason: 'The start year must be the same as or earlier than the end year.' });
  return { manufacturer, model, range, match: criteria.match === 'any' ? 'any' : 'all', valid: validationErrors.length === 0, validationErrors };
}

function publishedYearRange(value) {
  if (!isPresent(value)) return null;
  const years = String(value).match(/\b\d{4}\b/g)?.map(Number) ?? [];
  if (!years.length) return null;
  return { from: Math.min(...years), to: Math.max(...years) };
}

function evaluateYear(published, requested) {
  if (!requested) return null;
  if (!published) return { state: 'unknown', reason: 'The assigned vehicle has no published CPTDB build-year range.' };
  if (published.to < requested.from || published.from > requested.to) return { state: 'false', reason: 'The published CPTDB build-year range is outside the requested range.' };
  if (published.from >= requested.from && published.to <= requested.to) return { state: 'true', reason: 'The published CPTDB build-year range is contained by the requested range.' };
  return { state: 'unknown', reason: 'The published CPTDB build-year range only partially overlaps the requested range.' };
}

function combine(states, mode) {
  if (mode === 'any') {
    if (states.some((item) => item.state === 'true')) return 'true';
    if (states.some((item) => item.state === 'unknown')) return 'unknown';
    return 'false';
  }
  if (states.some((item) => item.state === 'false')) return 'false';
  if (states.some((item) => item.state === 'unknown')) return 'unknown';
  return 'true';
}

function evaluateAssignedVehicle(cptdb, criteria) {
  const checks = [];
  if (criteria.manufacturer) {
    checks.push(!isPresent(cptdb?.manufacturer)
      ? { field: 'manufacturer', state: 'unknown', reason: 'The assigned vehicle has no CPTDB manufacturer.' }
      : { field: 'manufacturer', state: normalise(cptdb.manufacturer) === criteria.manufacturer ? 'true' : 'false', reason: 'Compared the assigned vehicle CPTDB manufacturer exactly after normalisation.' });
  }
  if (criteria.model) {
    checks.push(!isPresent(cptdb?.model)
      ? { field: 'model', state: 'unknown', reason: 'The assigned vehicle has no CPTDB model.' }
      : { field: 'model', state: normalise(cptdb.model) === criteria.model ? 'true' : 'false', reason: 'Compared the assigned vehicle CPTDB model exactly after normalisation.' });
  }
  if (criteria.range) {
    const result = evaluateYear(publishedYearRange(cptdb?.year), criteria.range);
    checks.push({ field: 'year', ...result });
  }
  return { state: combine(checks, criteria.match), checks };
}

/** Evaluate one itinerary without mutating it. States are the strings true, false, or unknown. */
export function evaluateJourneyPreferences(itinerary, inputCriteria = {}, inputOptions = {}) {
  const criteria = requestedCriteria(inputCriteria);
  const options = { prefer: Boolean(inputOptions.prefer), avoid: Boolean(inputOptions.avoid), includeUnconfirmed: Boolean(inputOptions.includeUnconfirmed) };
  const active = criteria.valid && Boolean(criteria.manufacturer || criteria.model || criteria.range);
  const legs = (Array.isArray(itinerary?.legs) ? itinerary.legs : []).map((leg, index) => {
    if (WALKING_MODES.has(String(leg?.mode ?? '').toUpperCase())) return { index, state: 'ignored', reason: 'Walking legs do not have vehicle preferences.', checks: [] };
    if (!criteria.valid) return { index, state: 'unknown', reason: 'Vehicle preferences were not applied because the requested year criteria are invalid.', checks: criteria.validationErrors.map(({ field, reason }) => ({ field, state: 'unknown', reason })) };
    const cptdb = leg?.vehicle?.cptdb;
    if (!cptdb || typeof cptdb !== 'object') return { index, state: 'unknown', reason: 'No assigned vehicle with CPTDB facts is available for this leg.', checks: [] };
    const result = active ? evaluateAssignedVehicle(cptdb, criteria) : { state: 'not-applicable', checks: [] };
    return { index, state: result.state, reason: active ? 'Evaluated only the assigned vehicle CPTDB facts.' : 'No vehicle criteria are active.', checks: result.checks };
  });
  const considered = legs.filter((leg) => leg.state !== 'ignored' && leg.state !== 'not-applicable');
  const matched = considered.some((leg) => leg.state === 'true');
  const unknown = considered.some((leg) => leg.state === 'unknown');
  const nonMatch = considered.length > 0 && considered.every((leg) => leg.state === 'false');
  return { criteria: { ...criteria, yearFrom: criteria.range?.from ?? null, yearTo: criteria.range?.to ?? null }, options, active, legs, summary: { matched, unknown, nonMatch } };
}

/**
 * Apply preference policy to an ordered itinerary list without changing any input object.
 * Prefer is a stable soft ranking. Avoid removes a known match, and treats an unconfirmed
 * non-walking assignment as excluded unless includeUnconfirmed is requested.
 */
export function applyJourneyPreferences(itineraries, criteria = {}, options = {}) {
  const list = Array.isArray(itineraries) ? itineraries : [];
  const evaluations = list.map((itinerary, index) => ({ itinerary, index, evidence: evaluateJourneyPreferences(itinerary, criteria, options) }));
  const avoidActive = Boolean(options.avoid) && evaluations.some((entry) => entry.evidence.active);
  const kept = [];
  const excluded = [];
  for (const entry of evaluations) {
    const { evidence } = entry;
    if (avoidActive && evidence.summary.matched) {
      excluded.push({ itinerary: entry.itinerary, index: entry.index, reason: 'Excluded because an assigned vehicle leg is a verified avoid match.', evidence });
    } else if (avoidActive && evidence.summary.unknown && !options.includeUnconfirmed) {
      excluded.push({ itinerary: entry.itinerary, index: entry.index, reason: 'Excluded because a non-walking leg has an unconfirmed vehicle assignment while avoid is active.', evidence });
    } else {
      kept.push({ ...entry, reason: Boolean(options.prefer) && evidence.active && evidence.summary.matched ? 'Preferred because an assigned vehicle leg is a verified match.' : 'Kept without a verified preference boost.' });
    }
  }
  if (Boolean(options.prefer)) kept.sort((left, right) => Number(right.evidence.active && right.evidence.summary.matched) - Number(left.evidence.active && left.evidence.summary.matched));
  return { itineraries: kept.map(({ itinerary }) => itinerary), kept: kept.map(({ itinerary, index, reason, evidence }) => ({ itinerary, index, reason, evidence })), excluded, preferenceApplied: evaluations.some((entry) => entry.evidence.active) && (Boolean(options.prefer) || avoidActive) };
}
