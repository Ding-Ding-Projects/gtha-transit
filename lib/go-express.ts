/**
 * GO Transit super express services.
 *
 * The published GO route catalog contains numeric routes only - 12, 16, 25, 47,
 * 56, 88 - and carries no branch letters. A branch such as 56A exists on the
 * trip, where GO writes it at the head of the headsign: "56A - DC Oshawa GO".
 * This module reads that published prefix and never guesses a branch from the
 * rest of the headsign text.
 *
 * The super express classification itself is declared by this project's owner.
 * It is not a field published in the GO feed, and every surface that shows the
 * label says so rather than presenting it as official GO branding.
 */

export const SUPER_EXPRESS_PROVENANCE = 'owner-declared';

/** Exact identities. A letter entry is a branch; a bare number is a whole route. */
export const SUPER_EXPRESS_IDENTITIES: readonly string[] = Object.freeze([
  '12B',
  '16',
  '25C',
  '47D',
  '56A',
  '88C',
]);

const GO_AGENCIES = new Set(['go transit', 'go']);

const clean = (value: string | undefined | null) =>
  (value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

/** True only for GO Transit, matched on the published agency name. */
export function isGoAgency(agency: string | undefined | null): boolean {
  const name = (agency ?? '').trim().toLowerCase();
  return GO_AGENCIES.has(name);
}

/**
 * Read the branch GO published at the head of a headsign, for example
 * "56A - DC Oshawa GO" on route 56. The branch must be this route's own number
 * followed by a single letter; anything else returns null rather than a guess.
 */
export function goBranch(
  route: string | undefined | null,
  headsign: string | undefined | null,
): string | null {
  const routeCode = clean(route);
  const head = clean(headsign);
  if (!routeCode || !head) return null;
  const leading = head.split(/[^0-9A-Z]/)[0];
  if (!leading) return null;
  if (leading === routeCode) return null;
  if (leading.length !== routeCode.length + 1) return null;
  if (!leading.startsWith(routeCode)) return null;
  const suffix = leading.slice(routeCode.length);
  return /^[A-Z]$/.test(suffix) ? leading : null;
}

export type SuperExpressMatch = {
  /** The exact identity that matched, as published or declared. */
  identity: string;
  /** A branch identity carries the letter; a route identity does not. */
  scope: 'branch' | 'route';
  provenance: typeof SUPER_EXPRESS_PROVENANCE;
};

/**
 * Decide whether one journey leg is a declared GO super express service.
 * A branch identity is matched from the published headsign prefix; a bare route
 * identity is matched from the published route code.
 */
export function superExpressFor(leg: {
  agency?: string | null;
  route?: string | null;
  headsign?: string | null;
}): SuperExpressMatch | null {
  if (!isGoAgency(leg.agency)) return null;
  const routeCode = clean(leg.route);
  if (!routeCode) return null;
  const branch = goBranch(leg.route, leg.headsign);
  if (branch && SUPER_EXPRESS_IDENTITIES.includes(branch)) {
    return { identity: branch, scope: 'branch', provenance: SUPER_EXPRESS_PROVENANCE };
  }
  if (!branch && SUPER_EXPRESS_IDENTITIES.includes(routeCode)) {
    return { identity: routeCode, scope: 'route', provenance: SUPER_EXPRESS_PROVENANCE };
  }
  return null;
}
