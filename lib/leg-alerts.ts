import type { Alert, Leg, Place } from './types';

/**
 * The TTC website alert feed types every route reference it publishes. A reference
 * naming a transit mode describes service on that route; a reference naming anything
 * else - "Escalator", "Elevator" - describes a fixed facility inside one station.
 * Both arrive in the same per-line alert list, which is why a station escalator
 * notice could previously appear beside an unrelated leg of a journey.
 */
const TRANSIT_ROUTE_TYPES = new Set([
  'subway',
  'bus',
  'streetcar',
  'tram',
  'light rail',
  'lightrail',
  'rail',
  'ferry',
  'subway/metro',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '11',
  '12',
]);

export type LegAlertKind = 'closure' | 'service' | 'facility';

export type LegAlert = {
  alert: Alert;
  kind: LegAlertKind;
  /** For a facility notice, the station the publisher named in its own title. */
  station?: string;
  /** For a closure, the stops of this leg the publisher listed as affected. */
  affectedStops?: string[];
};

/** The publisher's own words for a segment carrying no service at all. */
const CLOSURE_EFFECTS = new Set(['no service']);

/** True when the publisher declared this alert a full loss of service. */
export function isClosure(alert: Alert): boolean {
  return CLOSURE_EFFECTS.has(lower(alert.effect));
}

const lower = (value: string | number | undefined) =>
  (typeof value === 'number' ? String(value) : (value ?? '')).trim().toLowerCase();

/** Normalize a published stop name to the station it belongs to. */
export function stationName(stopName: string | undefined | null): string {
  const raw = String(stopName ?? '').trim();
  if (!raw) return '';
  const beforeStation = raw.split(/\s+station\b/i)[0];
  const value = beforeStation === raw ? raw.split(' - ')[0] : beforeStation;
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The publisher writes a facility notice as "<Station>: <what is out of service>".
 * Only that exact prefix is used; nothing is inferred from the description text.
 */
export function alertSubject(title: string | undefined): string {
  const raw = String(title ?? '');
  const separator = raw.indexOf(':');
  if (separator < 0) return '';
  return raw.slice(0, separator).trim().toLowerCase().replace(/\s+/g, ' ');
}

function routeTypesFor(alert: Alert, route: string): (string | number)[] {
  const refs = (alert.routeRefs || []).filter((ref) => String(ref?.routeId ?? '') === route);
  return (refs.length ? refs : alert.routeRefs || []).map((ref) => ref?.routeType ?? '');
}

/** A reference that names no transit mode is describing a station facility. */
export function alertKind(alert: Alert, route: string): LegAlertKind {
  const types = routeTypesFor(alert, route).map(lower).filter(Boolean);
  if (!types.length) return 'service';
  return types.some((type) => TRANSIT_ROUTE_TYPES.has(type)) ? 'service' : 'facility';
}

function instant(value: number | string | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = typeof value === 'number'
    ? (value < 1e12 ? value * 1000 : value)
    : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** An absent boundary is open ended, exactly as the publisher left it. */
function overlapsLeg(alert: Alert, legStart?: number, legEnd?: number): boolean {
  const from = instant(alert.activeFrom);
  const to = instant(alert.activeTo);
  if (from != null && legEnd != null && from > legEnd) return false;
  if (to != null && legStart != null && to < legStart) return false;
  return true;
}

/** Bare stop identity, ignoring only a known feed alias. */
function bareStop(value: string | undefined): string {
  const raw = (value ?? '').trim();
  const separator = raw.indexOf(':');
  return separator > 0 ? raw.slice(separator + 1) : raw;
}

function legStopIds(leg: {
  from?: Place;
  to?: Place;
  intermediateStops?: Place[] | null;
}): Map<string, string> {
  const stops = [leg.from, leg.to, ...(leg.intermediateStops || [])];
  const found = new Map<string, string>();
  for (const stop of stops) {
    const id = bareStop(stop?.stopId ?? stop?.id);
    if (id) found.set(id, stop?.name ?? id);
  }
  return found;
}

function legStations(leg: {
  from?: Place;
  to?: Place;
  intermediateStops?: Place[] | null;
}): Set<string> {
  const stops = [leg.from, leg.to, ...(leg.intermediateStops || [])];
  const names = new Set<string>();
  for (const stop of stops) {
    const name = stationName(stop?.name);
    if (name) names.add(name);
  }
  return names;
}

export type LegAlertInput = Pick<
  Leg,
  'route' | 'agency' | 'from' | 'to' | 'intermediateStops' | 'startTime' | 'endTime'
> & { mode?: string };

/**
 * Choose the alerts that genuinely belong beside one transit leg.
 *
 * A service alert is shown when the publisher scoped it to this route, or to the
 * whole network, and its active window overlaps the leg. A facility notice is shown
 * only when the leg actually calls at the station the publisher named. Every match
 * is returned so nothing is hidden behind an arbitrary first entry.
 */
export function selectLegAlerts(options: {
  alerts?: readonly Alert[] | null;
  leg: LegAlertInput;
}): LegAlert[] {
  const { leg } = options;
  const route = String(leg.route ?? '').trim();
  if (!route || !leg.agency?.includes('TTC')) return [];
  const legStart = instant(leg.startTime);
  const legEnd = instant(leg.endTime);
  const stations = legStations(leg);
  const seen = new Set<string>();
  const selected: LegAlert[] = [];
  for (const alert of options.alerts || []) {
    if (!alert || seen.has(alert.id)) continue;
    const network = alert.routeScope === 'network';
    if (!network && !(alert.routeIds || []).some((id) => String(id ?? '') === route)) continue;
    if (!overlapsLeg(alert, legStart, legEnd)) continue;
    if (isClosure(alert)) {
      // A closure reaches a leg only through the stops the publisher listed itself.
      const listed = alert.affectedStopIds || [];
      const stopIds = legStopIds(leg);
      const affected = listed.map(bareStop).filter((id) => stopIds.has(id)).map((id) => stopIds.get(id) as string);
      if (!affected.length) continue;
      seen.add(alert.id);
      selected.push({ alert, kind: 'closure', affectedStops: [...new Set(affected)] });
      continue;
    }
    const kind = network ? 'service' : alertKind(alert, route);
    if (kind === 'facility') {
      const station = alertSubject(alert.title);
      if (!station || !stations.has(station)) continue;
      seen.add(alert.id);
      selected.push({ alert, kind, station });
      continue;
    }
    seen.add(alert.id);
    selected.push({ alert, kind });
  }
  return selected;
}
