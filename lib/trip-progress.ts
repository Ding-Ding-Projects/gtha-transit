import type { Itinerary, Place } from './types';

/** The source fields the follower can display without inventing any data. */
export type TripProgressPlace = Partial<
  Pick<Place, 'id' | 'name' | 'lat' | 'lon' | 'kind' | 'agency'>
>;

export type TripStopSource = 'from' | 'intermediate' | 'to';

/** One occurrence of a physical stop in a routing leg. */
export type TripStopReference = {
  legIndex: number;
  source: TripStopSource;
};

/** A physical stop that can retain multiple route-leg references. */
export type TripProgressStop = {
  key: string | null;
  place: TripProgressPlace;
  references: readonly TripStopReference[];
  startsLegs: readonly number[];
  endsLegs: readonly number[];
  transfer: boolean;
};

/** Null marks a missing or unusable boundary stop without inventing an index. */
export type TripStopLegBoundary = {
  legIndex: number;
  fromIndex: number | null;
  toIndex: number | null;
};

export type TripStopTimeline = {
  stops: readonly TripProgressStop[];
  legBoundaries: readonly TripStopLegBoundary[];
};

export const LIVE_POSITION_FRESH_MS = 120_000;
export const LOCAL_POSITION_FRESH_MS = 30_000;
export const MAX_LOCAL_POSITION_ACCURACY_METRES = 150;

export type ReportedVehicleIdentity = {
  id?: string;
  agencyId?: string;
  routeId?: string;
};

export type ReportedVehiclePosition = ReportedVehicleIdentity & {
  timestamp?: string | number;
  stale?: boolean;
  stopId?: string;
  nextStopId?: string;
  stopStatus?: string;
};

export type ReportedPositionState = 'fresh' | 'stale' | 'unavailable';

export type BrowserLocationPosition = {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
  };
  timestamp: number;
};

export type BrowserLocationWatchBoundary = {
  watchPosition(
    onPosition: (position: BrowserLocationPosition) => void,
    onError: () => void,
    options: {
      enableHighAccuracy: boolean;
      maximumAge: number;
      timeout: number;
    },
  ): number;
  clearWatch(watchId: number): void;
};

export type BrowserLocationWatchController = {
  readonly active: boolean;
  start(): boolean;
  stop(): boolean;
};

export type LocalPositionObservation = {
  lat: number;
  lon: number;
  accuracy: number;
  timestamp: number;
};

export type EstimatedStopProgress = {
  nextIndex: number;
  progress: number;
  distanceMetres: number;
};

type ItineraryLike = Pick<Itinerary, 'legs'> | { legs?: readonly unknown[] } | null | undefined;

type TripProgressLeg = {
  mode?: string;
  from?: TripProgressPlace;
  to?: TripProgressPlace;
  intermediateStops?: readonly TripProgressPlace[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export const positionTimestampMilliseconds = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value))
    return value < 1_000_000_000_000 ? value * 1000 : value;
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

export function reportedPositionState(
  position: ReportedVehiclePosition | null | undefined,
  now: number,
): ReportedPositionState {
  const observed = positionTimestampMilliseconds(position?.timestamp);
  if (observed === null || observed > now + 30_000) return 'unavailable';
  if (position?.stale || now - observed > LIVE_POSITION_FRESH_MS) return 'stale';
  return 'fresh';
}

const reportedVehicleKey = (value: ReportedVehicleIdentity | null | undefined) => {
  const id = text(value?.id);
  return id ? `${text(value?.agencyId) || 'ttc'}:${id}` : null;
};

/** Never match by route, headsign, or coordinate. A live identity needs both agency and vehicle id. */
export function exactReportedVehicle<T extends ReportedVehicleIdentity>(
  candidates: readonly T[] | null | undefined,
  expected: ReportedVehicleIdentity | null | undefined,
): T | null {
  const expectedKey = reportedVehicleKey(expected);
  if (!expectedKey) return null;
  return candidates?.find((candidate) => reportedVehicleKey(candidate) === expectedKey) || null;
}

/** Returns a next-stop id only when the publisher explicitly labels it as upcoming. */
export function publisherNextStopId(
  position: ReportedVehiclePosition | null | undefined,
): string | null {
  const status = text(position?.stopStatus)?.toLocaleLowerCase();
  if (!status || !/(next|upcoming|approach)/.test(status)) return null;
  return text(position?.nextStopId) || text(position?.stopId) || null;
}

/** Creates an explicit, idempotent browser watch that callers start only from user input. */
export function createBrowserLocationWatch(
  browser: BrowserLocationWatchBoundary,
  onPosition: (position: BrowserLocationPosition) => void,
  onError: () => void,
): BrowserLocationWatchController {
  let watchId: number | null = null;
  let active = false;
  let generation = 0;
  const stop = () => {
    if (!active) return false;
    active = false;
    generation++;
    if (watchId !== null) browser.clearWatch(watchId);
    watchId = null;
    return true;
  };
  return {
    get active() {
      return active;
    },
    start() {
      if (active) return false;
      active = true;
      const currentGeneration = ++generation;
      try {
        const requestedWatchId = browser.watchPosition(
          (position) => {
            if (active && generation === currentGeneration) onPosition(position);
          },
          () => {
            if (active && generation === currentGeneration) {
              stop();
              onError();
            }
          },
          { enableHighAccuracy: false, maximumAge: 0, timeout: 10_000 },
        );
        if (active && generation === currentGeneration) watchId = requestedWatchId;
        else browser.clearWatch(requestedWatchId);
        return active && generation === currentGeneration;
      } catch (error) {
        active = false;
        generation++;
        throw error;
      }
    },
    stop() {
      return stop();
    },
  };
}

const normalizedName = (name: string | undefined): string | null => {
  if (!name) return null;
  const normalized = name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return normalized || null;
};

/**
 * Returns an evidence-backed physical-stop key. Exact source IDs win. Without
 * an ID, the key requires both a normalized name and finite coordinates rounded
 * to six decimal places. Name-only records deliberately remain unmergeable.
 */
export function physicalStopKey(place: TripProgressPlace | null | undefined): string | null {
  if (!place) return null;
  const id = text(place.id);
  if (id) return `id:${id}`;

  const name = normalizedName(text(place.name));
  const lat = finiteNumber(place.lat);
  const lon = finiteNumber(place.lon);
  if (!name || lat === undefined || lon === undefined) return null;

  return `name-coordinate:${name}:${lat.toFixed(6)}:${lon.toFixed(6)}`;
}

const isTransitLeg = (leg: TripProgressLeg | null): leg is TripProgressLeg =>
  leg !== null && text(leg.mode)?.toUpperCase() !== 'WALK';

const place = (value: unknown): TripProgressPlace | null => {
  if (!isRecord(value)) return null;
  const result: TripProgressPlace = {};
  const id = text(value.id);
  const name = text(value.name);
  const lat = finiteNumber(value.lat);
  const lon = finiteNumber(value.lon);
  const kind = text(value.kind);
  const agency = text(value.agency);

  if (id) result.id = id;
  if (name) result.name = name;
  if (lat !== undefined) result.lat = lat;
  if (lon !== undefined) result.lon = lon;
  if (kind) result.kind = kind;
  if (agency) result.agency = agency;
  return result;
};

const tripProgressLeg = (value: unknown): TripProgressLeg | null => {
  if (!isRecord(value)) return null;
  const from = place(value.from);
  const to = place(value.to);
  const intermediateStops = Array.isArray(value.intermediateStops)
    ? value.intermediateStops.map(place).filter((stop): stop is TripProgressPlace => stop !== null)
    : undefined;
  const mode = text(value.mode);

  return {
    ...(mode ? { mode } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(intermediateStops ? { intermediateStops } : {}),
  };
};

const samePhysicalStop = (left: TripProgressStop, rightKey: string | null) =>
  left.key !== null && rightKey !== null && left.key === rightKey;

const appendUnique = (values: number[], value: number) => {
  if (!values.includes(value)) values.push(value);
};

/**
 * Converts transit legs into physical stops. Only consecutive occurrences with
 * matching source-backed keys merge. A shared `to`/`from` transfer stop renders
 * once while retaining both leg references and both boundaries.
 */
export function buildTripStopTimeline(journey: ItineraryLike): TripStopTimeline {
  const stops: Array<{
    key: string | null;
    place: TripProgressPlace;
    references: TripStopReference[];
    startsLegs: number[];
    endsLegs: number[];
    transfer: boolean;
  }> = [];
  const legBoundaries: TripStopLegBoundary[] = [];
  const sourceLegs = Array.isArray(journey?.legs) ? journey.legs : [];

  sourceLegs.forEach((sourceLeg, legIndex) => {
    const leg = tripProgressLeg(sourceLeg);
    if (!isTransitLeg(leg)) return;

    let fromIndex: number | null = null;
    let toIndex: number | null = null;
    const candidates: Array<{ source: TripStopSource; place: TripProgressPlace }> = [];
    if (leg.from) candidates.push({ source: 'from', place: leg.from });
    for (const intermediate of leg.intermediateStops ?? []) {
      candidates.push({ source: 'intermediate', place: intermediate });
    }
    if (leg.to) candidates.push({ source: 'to', place: leg.to });

    for (const candidate of candidates) {
      const key = physicalStopKey(candidate.place);
      let index = stops.length;
      const previous = stops[stops.length - 1];
      if (previous && samePhysicalStop(previous, key)) {
        index = stops.length - 1;
      } else {
        stops.push({ key, place: candidate.place, references: [], startsLegs: [], endsLegs: [], transfer: false });
      }

      const stop = stops[index];
      stop.references.push({ legIndex, source: candidate.source });
      if (candidate.source === 'from') {
        appendUnique(stop.startsLegs, legIndex);
        fromIndex = index;
      }
      if (candidate.source === 'to') {
        appendUnique(stop.endsLegs, legIndex);
        toIndex = index;
      }
      stop.transfer = stop.startsLegs.some((start) => stop.endsLegs.some((end) => start !== end));
    }

    legBoundaries.push({ legIndex, fromIndex, toIndex });
  });

  return { stops, legBoundaries };
}

/** A simulation can select only a published timeline stop. It never creates one. */
export function previewTimelineStop(
  timeline: TripStopTimeline,
  index: number,
): TripProgressStop | null {
  return Number.isInteger(index) && index >= 0 && index < timeline.stops.length
    ? timeline.stops[index]
    : null;
}

const validCoordinates = (lat: unknown, lon: unknown) => {
  const validLat = finiteNumber(lat);
  const validLon = finiteNumber(lon);
  return (
    validLat !== undefined &&
    validLon !== undefined &&
    Math.abs(validLat) <= 90 &&
    Math.abs(validLon) <= 180
  );
};

const projectedSegmentDistance = (
  point: LocalPositionObservation,
  from: TripProgressPlace,
  to: TripProgressPlace,
) => {
  if (!validCoordinates(point.lat, point.lon)) return null;
  if (!validCoordinates(from.lat, from.lon) || !validCoordinates(to.lat, to.lon))
    return null;
  const originLatitude = (Number(from.lat) + Number(to.lat) + point.lat) / 3;
  const metresPerLatitude = 111_132;
  const metresPerLongitude = 111_320 * Math.cos((originLatitude * Math.PI) / 180);
  const fromX = Number(from.lon) * metresPerLongitude;
  const fromY = Number(from.lat) * metresPerLatitude;
  const toX = Number(to.lon) * metresPerLongitude;
  const toY = Number(to.lat) * metresPerLatitude;
  const pointX = point.lon * metresPerLongitude;
  const pointY = point.lat * metresPerLatitude;
  const deltaX = toX - fromX;
  const deltaY = toY - fromY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared <= 0) return null;
  const rawProgress =
    ((pointX - fromX) * deltaX + (pointY - fromY) * deltaY) / lengthSquared;
  const progress = Math.min(1, Math.max(0, rawProgress));
  const nearestX = fromX + deltaX * progress;
  const nearestY = fromY + deltaY * progress;
  return {
    progress,
    distanceMetres: Math.hypot(pointX - nearestX, pointY - nearestY),
  };
};

/**
 * Conservatively advances a preview from a fresh, accurate local position and
 * nearby published stop geometry. It cannot move backwards or skip more than
 * two stops in one observation.
 */
export function estimatePreviewStopFromPosition(
  timeline: TripStopTimeline,
  position: LocalPositionObservation | null | undefined,
  currentIndex: number,
  now: number,
): EstimatedStopProgress | null {
  if (!position || !Number.isInteger(currentIndex)) return null;
  if (
    !Number.isFinite(position.accuracy) ||
    position.accuracy < 0 ||
    position.accuracy > MAX_LOCAL_POSITION_ACCURACY_METRES ||
    now - position.timestamp > LOCAL_POSITION_FRESH_MS ||
    position.timestamp > now + 30_000 ||
    !validCoordinates(position.lat, position.lon)
  )
    return null;
  if (timeline.stops.length < 2 || currentIndex < 0 || currentIndex >= timeline.stops.length)
    return null;

  const firstSegment = Math.max(0, currentIndex - 1);
  const lastSegment = Math.min(timeline.stops.length - 2, currentIndex + 2);
  let best: { progress: number; distanceMetres: number } | null = null;
  let bestSegment = -1;
  for (let index = firstSegment; index <= lastSegment; index++) {
    const projected = projectedSegmentDistance(
      position,
      timeline.stops[index].place,
      timeline.stops[index + 1].place,
    );
    if (!projected || (best && projected.distanceMetres >= best.distanceMetres)) continue;
    best = projected;
    bestSegment = index;
  }
  if (!best || bestSegment < 0) return null;

  const maximumDistance = Math.min(250, Math.max(50, position.accuracy * 1.5));
  if (best.distanceMetres > maximumDistance) return null;
  const nextIndex = Math.min(
    timeline.stops.length - 1,
    currentIndex + 2,
    Math.floor(bestSegment + best.progress) + 1,
  );
  return {
    nextIndex,
    progress: bestSegment + best.progress,
    distanceMetres: best.distanceMetres,
  };
}
