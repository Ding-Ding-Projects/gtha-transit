/**
 * The dim sum surprise.
 *
 * A one-in-ten chance, at startup, of a dish and its picture. It is a small
 * delight and not a feature anybody has to manage, which is why there is no
 * setting for it anywhere and this module exposes none.
 *
 * What makes an un-optable surprise polite is everything around it: it never
 * gates startup, never steals focus, never appears during a first run or an
 * error, and dismisses itself. A surprise that blocked anything would have to be
 * switchable off, and then it would not be a surprise, it would be a setting.
 */

export type DimSumDish = {
  id: string;
  slug: string;
  en: string;
  zhHant: string;
  alt: string;
  file: string;
  bytes: number;
  sha256: string;
};

export type DimSumManifest = {
  schemaVersion: number;
  transform?: { width: number; height: number; format: string };
  dishes: DimSumDish[];
};

/** One in ten. Never more often than stated, and never twice in one launch. */
export const DIM_SUM_CHANCE = 0.1;

/** Where the vendored set is served from, on this origin. */
export const DIM_SUM_MANIFEST = '/dim-sum/manifest.json';
export const DIM_SUM_DIRECTORY = '/dim-sum/';

/** How long it stays before it dismisses itself. */
export const DIM_SUM_MS = 9_000;

/**
 * The draw.
 *
 * Taken once per launch from a fresh random value. Passing the value in rather
 * than calling Math.random here is what makes the ten per cent testable at all:
 * a module that rolls its own dice can only be checked statistically, and a
 * statistical check of a one-in-ten event is a flaky test.
 */
export const drawsSurprise = (value: number): boolean => Number.isFinite(value) && value >= 0 && value < DIM_SUM_CHANCE;

/**
 * Which dish, from the vendored set.
 *
 * Returns null rather than a placeholder when there is nothing to show. A
 * surprise with a missing picture is not a smaller surprise, it is a broken one.
 */
export function chooseDish(manifest: DimSumManifest | null, value: number): DimSumDish | null {
  const dishes = manifest?.dishes;
  if (!Array.isArray(dishes) || dishes.length === 0) return null;
  if (!Number.isFinite(value) || value < 0 || value >= 1) return null;
  return dishes[Math.floor(value * dishes.length)] ?? null;
}

/** The dish's own name, in both languages, exactly as the catalog records it. */
export const dishName = (dish: DimSumDish): string => `${dish.en} · ${dish.zhHant}`;

export const dishImage = (dish: DimSumDish): string => DIM_SUM_DIRECTORY + dish.file;

/**
 * Read a manifest that the vendoring script wrote.
 *
 * Anything unreadable leaves the surprise unavailable rather than half-loaded.
 * Every dish has to carry both names, a file and alt text: a picture with no
 * alt text is a delight that skips the people using a screen reader, which is
 * the opposite of the point.
 */
export function parseManifest(raw: unknown): DimSumManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const { schemaVersion, dishes, transform } = raw as Record<string, unknown>;
  if (schemaVersion !== 1 || !Array.isArray(dishes)) return null;
  const usable: DimSumDish[] = [];
  for (const candidate of dishes) {
    if (!candidate || typeof candidate !== 'object') continue;
    const dish = candidate as Record<string, unknown>;
    const strings = ['id', 'slug', 'en', 'zhHant', 'alt', 'file'] as const;
    if (!strings.every((key) => typeof dish[key] === 'string' && (dish[key] as string).length > 0)) continue;
    // A file name that is a path is a file name that can leave the directory.
    if ((dish.file as string).includes('/') || (dish.file as string).includes('\\')) continue;
    usable.push({
      id: dish.id as string,
      slug: dish.slug as string,
      en: dish.en as string,
      zhHant: dish.zhHant as string,
      alt: dish.alt as string,
      file: dish.file as string,
      bytes: Number.isFinite(dish.bytes) ? (dish.bytes as number) : 0,
      sha256: typeof dish.sha256 === 'string' ? dish.sha256 : '',
    });
  }
  if (!usable.length) return null;
  return {
    schemaVersion: 1,
    transform: transform && typeof transform === 'object' ? (transform as DimSumManifest['transform']) : undefined,
    dishes: usable,
  };
}

/**
 * Is this a moment to surprise somebody?
 *
 * Never during a first run, an error, an update, or while somebody is part-way
 * through something. The list is the caller's to supply, because only the caller
 * knows what it is doing; what this refuses to do is guess that any moment is
 * fine.
 */
export function momentIsRight(conditions: { firstRun?: boolean; error?: boolean; busy?: boolean; suppressed?: boolean }): boolean {
  return !conditions.firstRun && !conditions.error && !conditions.busy && !conditions.suppressed;
}
