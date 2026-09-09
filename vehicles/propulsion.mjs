/**
 * Classifies the published `propulsion` string already carried by a fleet
 * registry row into a small, closed set of buckets, and labels that bucket in
 * both languages.
 *
 * This module never guesses a propulsion from a manufacturer, model, or
 * fleet number. A row with no published `propulsion` field - or one this
 * module does not recognise - classifies as `unknown`, and `unknown` never
 * counts as electric. That asymmetry is deliberate: a wrong "yes" tells a
 * rider to expect a vehicle that might not show up, and a wrong "no" only
 * costs them a filter they did not need.
 */

/** The closed set of propulsion buckets. Order is not significant. */
export const PROPULSION_CLASSES = Object.freeze(['battery-electric', 'electric', 'hybrid', 'diesel', 'cng', 'unknown']);

const LABELS = Object.freeze({
  'battery-electric': { en: 'Battery electric', zh: '電池電動' },
  electric: { en: 'Electric', zh: '電動' },
  hybrid: { en: 'Hybrid', zh: '混能' },
  diesel: { en: 'Diesel', zh: '柴油' },
  cng: { en: 'Natural gas', zh: '天然氣' },
  unknown: { en: 'Unknown', zh: '未知' },
});

/**
 * Maps a fact object's published `propulsion` string to a class. Matching is
 * case-insensitive and deliberately ordered: "battery electric" and anything
 * naming a hybrid or natural gas are resolved before the plain "diesel" and
 * "electric" checks, so "Diesel-electric hybrid" reports as a hybrid rather
 * than either half of its own name, and "Diesel-electric" locomotives - which
 * are diesel-powered, not plug-in electric - report as diesel.
 */
export function propulsionClass(fact) {
  const raw = String(fact?.propulsion ?? '').trim().toLocaleLowerCase();
  if (!raw) return 'unknown';
  if (raw.includes('battery electric')) return 'battery-electric';
  if (raw.includes('hybrid')) return 'hybrid';
  if (raw.includes('natural gas') || raw.includes('cng')) return 'cng';
  if (raw.includes('diesel')) return 'diesel';
  if (raw.includes('electric')) return 'electric';
  return 'unknown';
}

/** True only for a verified battery-electric or (streetcar) electric class. Never true for `unknown`. */
export function isElectric(cls) {
  return cls === 'battery-electric' || cls === 'electric';
}

/**
 * Bilingual label for a propulsion class. Pass `{ streetcar: true }` for a
 * vehicle whose model is a streetcar (TTC's FLEXITY M-1 fleet is the only
 * `electric`, as opposed to `battery-electric`, series today) to read
 * "Electric (streetcar)" rather than the bare "Electric" a trolleybus or
 * other wired vehicle would otherwise share the label with.
 */
export function propulsionLabel(cls, { streetcar = false } = {}) {
  if (cls === 'electric' && streetcar) return { en: 'Electric (streetcar)', zh: '電動（電車）' };
  return LABELS[cls] ?? LABELS.unknown;
}
