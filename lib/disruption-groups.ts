export type TtcRouteType = string | number;

export type TtcRouteReference = {
  routeId?: string | null;
  routeType?: TtcRouteType | null;
};

export type TtcDisruptionAlert = {
  id?: string | null;
  routeIds?: readonly (string | null | undefined)[];
  routeRefs?: readonly TtcRouteReference[];
  routeScope?: 'routes' | 'network' | 'unknown';
  routeType?: TtcRouteType | null;
  routeTypes?: readonly (TtcRouteType | null | undefined)[];
};

export type OfficialTtcRoute = {
  routeId?: string | null;
  routeType?: TtcRouteType | null;
  feedId?: string | null;
};

export type DisruptionGroup =
  | 'rapidTransit'
  | 'streetcar'
  | 'bus'
  | 'networkWide'
  | 'unknown';

export type TtcRouteMode = 'subway' | 'light-rail' | 'streetcar' | 'bus' | 'unknown';

export type TtcRouteClassification = {
  group: Exclude<DisruptionGroup, 'networkWide'>;
  mode: TtcRouteMode;
};

export type GroupedTtcDisruptions<T extends TtcDisruptionAlert> = {
  totalDistinct: number;
  rapidTransit: T[];
  streetcar: T[];
  bus: T[];
  networkWide: T[];
  unknown: T[];
};

export const TTC_RAPID_ROUTE_MODES: Readonly<Record<string, 'subway' | 'light-rail'>> = Object.freeze({
  '1': 'subway',
  '2': 'subway',
  '4': 'subway',
  '5': 'light-rail',
  '6': 'light-rail',
});

const groupKeys: readonly DisruptionGroup[] = ['rapidTransit', 'streetcar', 'bus', 'networkWide', 'unknown'];
const routeId = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const hasRouteType = (value: unknown): value is TtcRouteType => typeof value === 'string' || typeof value === 'number';

function normalizedRouteType(value: TtcRouteType) {
  return typeof value === 'number'
    ? value
    : value.trim().toLocaleLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ');
}

function classifyRouteType(routeType: TtcRouteType | null | undefined, scopedRouteId: string): TtcRouteClassification | null {
  if (!hasRouteType(routeType)) return null;
  const type = normalizedRouteType(routeType);
  if (type === 3 || type === '3' || type === 'bus' || type === 'bus rapid transit') return { group: 'bus', mode: 'bus' };
  if (type === 1 || type === '1' || type === 'subway' || type === 'metro' || type === 'rapid transit') return { group: 'rapidTransit', mode: 'subway' };
  if (type === 'light rail' || type === 'lrt') return { group: 'rapidTransit', mode: 'light-rail' };
  // GTFS route type 0 includes tram, streetcar, and light rail. A current TTC rapid-line id wins
  // before this fallback, while an unscoped zero stays unclassified rather than being guessed.
  if (scopedRouteId && (type === 0 || type === '0' || type === 'streetcar' || type === 'tram' || type === 'tramway')) return { group: 'streetcar', mode: 'streetcar' };
  if (type === 'streetcar' || type === 'tram' || type === 'tramway') return { group: 'streetcar', mode: 'streetcar' };
  return null;
}

function officialRouteTypes(routes: readonly OfficialTtcRoute[]) {
  const result = new Map<string, TtcRouteType>();
  for (const route of routes) {
    const feedId = routeId(route.feedId).toLocaleLowerCase();
    const id = routeId(route.routeId);
    if (!id || (feedId && feedId !== 'ttc') || !hasRouteType(route.routeType) || result.has(id)) continue;
    result.set(id, route.routeType);
  }
  return result;
}

export function classifyTtcRoute(
  value: Pick<TtcRouteReference, 'routeId' | 'routeType'>,
  routes: readonly OfficialTtcRoute[] = [],
): TtcRouteClassification {
  const id = routeId(value.routeId);
  const rapidMode = TTC_RAPID_ROUTE_MODES[id];
  if (rapidMode) return { group: 'rapidTransit', mode: rapidMode };
  // Numeric GTFS-Realtime route_type is transport metadata. The TTC website's text label is a
  // useful fallback, but a matching official GTFS catalog row wins when a publisher label conflicts.
  const numericExplicit = typeof value.routeType === 'number' ? classifyRouteType(value.routeType, id) : null;
  if (numericExplicit) return numericExplicit;
  const catalog = officialRouteTypes(routes).get(id);
  const catalogClassification = classifyRouteType(catalog, id);
  if (catalogClassification) return catalogClassification;
  return classifyRouteType(value.routeType, id) ?? { group: 'unknown', mode: 'unknown' };
}

function alertReferences(alert: TtcDisruptionAlert) {
  const refs = Array.isArray(alert.routeRefs)
    ? alert.routeRefs.filter((ref) => ref && (routeId(ref.routeId) || hasRouteType(ref.routeType)))
    : [];
  const referencedIds = new Set(refs.map((ref) => routeId(ref.routeId)).filter(Boolean));
  for (const id of Array.isArray(alert.routeIds) ? alert.routeIds.map(routeId).filter(Boolean) : []) {
    if (!referencedIds.has(id)) refs.push({ routeId: id });
  }
  const topLevelTypes = [alert.routeType, ...(Array.isArray(alert.routeTypes) ? alert.routeTypes : [])].filter(hasRouteType);
  if (!refs.length && topLevelTypes.length) return topLevelTypes.map((routeType) => ({ routeType }));
  if (topLevelTypes.length === 1) return refs.map((ref) => hasRouteType(ref.routeType) ? ref : { ...ref, routeType: topLevelTypes[0] });
  return refs;
}

function groupsForAlert(alert: TtcDisruptionAlert, routes: readonly OfficialTtcRoute[]) {
  const refs = alertReferences(alert);
  if (alert.routeScope === 'network') return new Set<DisruptionGroup>(['networkWide']);
  if (!refs.length) return new Set<DisruptionGroup>(['unknown']);
  return new Set(refs.map((ref) => classifyTtcRoute(ref, routes).group));
}

export function groupTtcDisruptions<T extends TtcDisruptionAlert>(
  alerts: readonly T[],
  routes: readonly OfficialTtcRoute[] = [],
): GroupedTtcDisruptions<T> {
  const grouped = Object.fromEntries(groupKeys.map((key) => [key, []])) as Record<DisruptionGroup, T[]>;
  const seenByGroup = new Map(groupKeys.map((key) => [key, new Set<string>()]));
  const all = new Set<string>();
  alerts.forEach((alert, index) => {
    const id = routeId(alert?.id) || `index:${index}`;
    all.add(id);
    for (const group of groupsForAlert(alert, routes)) {
      const seen = seenByGroup.get(group)!;
      if (seen.has(id)) continue;
      seen.add(id);
      grouped[group].push(alert);
    }
  });
  return { totalDistinct: all.size, ...grouped };
}
