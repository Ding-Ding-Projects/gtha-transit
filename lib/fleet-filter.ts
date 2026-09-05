/**
 * Pure filtering over verified CPTDB vehicle facts. This module deliberately
 * does not infer a vehicle property from route, trip, agency, or free text.
 */

export type FleetFilter = {
  manufacturer: string;
  model: string;
  yearFrom: string;
  yearTo: string;
  includeUnknown: boolean;
};

type FleetVehicle = {
  cptdb?: {
    manufacturer?: string | null;
    model?: string | null;
    year?: string | number | null;
  };
};

type YearRange = { from: number; to: number };
type RequestedYear =
  | { state: 'empty' }
  | { state: 'invalid' }
  | { state: 'valid'; value: number };
type FieldState = 'match' | 'mismatch' | 'unknown';

export type FleetFilterResult<T> = {
  vehicles: T[];
  active: boolean;
  error: string | null;
  unknownCount: number;
  excludedUnknownCount: number;
};

const MINIMUM_YEAR = 1800;
const MAXIMUM_YEAR = 3000;
const INVALID_YEAR_ERROR = 'Enter a whole year from 1800 through 3000.';
const REVERSED_YEAR_ERROR =
  'The start year must be the same as or earlier than the end year.';
const MODEL_REQUIRES_MANUFACTURER_ERROR =
  'Select a manufacturer before filtering by model.';

export function emptyFleetFilter(): FleetFilter {
  return {
    manufacturer: '',
    model: '',
    yearFrom: '',
    yearTo: '',
    includeUnknown: false,
  };
}

function displayText(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : '';
}

function normaliseText(value: unknown): string {
  return displayText(value).toLocaleLowerCase();
}

function wholeYear(value: string): number | null {
  if (value.length !== 4) return null;

  let year = 0;
  for (let index = 0; index < value.length; index += 1) {
    const digit = value.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) return null;
    year = year * 10 + digit;
  }

  return year >= MINIMUM_YEAR && year <= MAXIMUM_YEAR ? year : null;
}

function requestedYear(value: unknown): RequestedYear {
  if (value === undefined || value === null) return { state: 'empty' };
  if (typeof value !== 'string') return { state: 'invalid' };

  const text = displayText(value);
  if (!text) return { state: 'empty' };

  const year = wholeYear(text);
  return year === null ? { state: 'invalid' } : { state: 'valid', value: year };
}

function publishedYearRange(value: unknown): YearRange | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) &&
      value >= MINIMUM_YEAR &&
      value <= MAXIMUM_YEAR
      ? { from: value, to: value }
      : null;
  }

  const text = displayText(value);
  if (!text) return null;

  const enDash = String.fromCharCode(0x2013);
  const hasHyphen = text.includes('-');
  const hasEnDash = text.includes(enDash);
  if (hasHyphen && hasEnDash) return null;

  const parts = (
    hasHyphen ? text.split('-') : hasEnDash ? text.split(enDash) : [text]
  ).map((part) => wholeYear(part.trim()));
  if (parts.some((part) => part === null)) return null;

  const years = parts as number[];
  if (years.length === 1) return { from: years[0], to: years[0] };
  if (years.length !== 2 || years[0] > years[1]) return null;
  return { from: years[0], to: years[1] };
}

function exactFieldState(value: unknown, expected: string): FieldState {
  const actual = normaliseText(value);
  if (!actual) return 'unknown';
  return actual === expected ? 'match' : 'mismatch';
}

function yearFieldState(value: unknown, requested: YearRange): FieldState {
  const published = publishedYearRange(value);
  if (!published) return 'unknown';
  return published.from <= requested.to && published.to >= requested.from
    ? 'match'
    : 'mismatch';
}

function stableMetadataOptions(values: Iterable<unknown>): string[] {
  const valuesByNormalisedText = new Map<string, string>();
  for (const value of values) {
    const text = displayText(value);
    const normalised = normaliseText(text);
    if (text && normalised && !valuesByNormalisedText.has(normalised)) {
      valuesByNormalisedText.set(normalised, text);
    }
  }

  return [...valuesByNormalisedText.values()].sort((left, right) => {
    const normalisedComparison = normaliseText(left).localeCompare(
      normaliseText(right),
    );
    return normalisedComparison || left.localeCompare(right);
  });
}

/** Returns verified manufacturer labels found only in supplied CPTDB metadata. */
export function manufacturerOptions<T extends FleetVehicle>(
  vehicles: readonly T[],
): string[] {
  return stableMetadataOptions(
    Array.from(vehicles, (vehicle) => vehicle?.cptdb?.manufacturer),
  );
}

/** Returns verified model labels for one exact normalised manufacturer selection. */
export function modelOptions<T extends FleetVehicle>(
  vehicles: readonly T[],
  manufacturer: string,
): string[] {
  const selectedManufacturer = normaliseText(manufacturer);
  if (!selectedManufacturer) return [];

  return stableMetadataOptions(
    Array.from(vehicles, (vehicle) =>
      normaliseText(vehicle?.cptdb?.manufacturer) === selectedManufacturer
        ? vehicle.cptdb?.model
        : undefined,
    ),
  );
}

function requestedRange(
  from: RequestedYear,
  to: RequestedYear,
): { range: YearRange | null; error: string | null } {
  if (from.state === 'invalid' || to.state === 'invalid') {
    return { range: null, error: INVALID_YEAR_ERROR };
  }

  if (from.state === 'empty' && to.state === 'empty') {
    return { range: null, error: null };
  }

  const range = {
    from: from.state === 'valid' ? from.value : MINIMUM_YEAR,
    to: to.state === 'valid' ? to.value : MAXIMUM_YEAR,
  };
  return range.from > range.to
    ? { range: null, error: REVERSED_YEAR_ERROR }
    : { range, error: null };
}

/**
 * Filters an ordered vehicle list without changing its array or its vehicle objects.
 * An active criterion includes a vehicle only when every known field matches. Missing
 * or malformed required facts become unknown candidates, unless another known field
 * already proves a mismatch.
 */
export function filterFleetVehicles<T extends FleetVehicle>(
  vehicles: readonly T[],
  filter: FleetFilter,
): FleetFilterResult<T> {
  const source = filter ?? emptyFleetFilter();
  const manufacturer = normaliseText(source.manufacturer);
  const model = normaliseText(source.model);
  const from = requestedYear(source.yearFrom);
  const to = requestedYear(source.yearTo);
  const active = Boolean(
    manufacturer || model || from.state !== 'empty' || to.state !== 'empty',
  );

  if (model && !manufacturer) {
    return {
      vehicles: [],
      active,
      error: MODEL_REQUIRES_MANUFACTURER_ERROR,
      unknownCount: 0,
      excludedUnknownCount: 0,
    };
  }

  const years = requestedRange(from, to);
  if (years.error) {
    return {
      vehicles: [],
      active,
      error: years.error,
      unknownCount: 0,
      excludedUnknownCount: 0,
    };
  }

  if (!active) {
    return {
      vehicles: Array.from(vehicles),
      active: false,
      error: null,
      unknownCount: 0,
      excludedUnknownCount: 0,
    };
  }

  const kept: T[] = [];
  let unknownCount = 0;
  let excludedUnknownCount = 0;

  for (const vehicle of vehicles) {
    const facts = vehicle?.cptdb;
    const states: FieldState[] = [];
    if (manufacturer)
      states.push(exactFieldState(facts?.manufacturer, manufacturer));
    if (model) states.push(exactFieldState(facts?.model, model));
    if (years.range) states.push(yearFieldState(facts?.year, years.range));

    if (states.includes('mismatch')) continue;
    if (states.includes('unknown')) {
      unknownCount += 1;
      if (source.includeUnknown) kept.push(vehicle);
      else excludedUnknownCount += 1;
      continue;
    }

    kept.push(vehicle);
  }

  return {
    vehicles: kept,
    active: true,
    error: null,
    unknownCount,
    excludedUnknownCount,
  };
}
