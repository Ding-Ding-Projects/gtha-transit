import type { Place } from './types';
const localFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Toronto',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
export function torontoLocalInput(value: Date = new Date()): string {
  return localFormatter.format(value).replace(' ', 'T');
}
/** Reject skipped local times. Repeated local times choose the earlier occurrence. */
export function torontoIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error('Choose a valid Toronto date and time.');
  const wall = Date.parse(value + 'Z');
  if (!Number.isFinite(wall))
    throw new Error('Choose a valid Toronto date and time.');
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    timeZoneName: 'longOffset',
  });
  const offsets = new Set(
    [-86400000, 0, 86400000].map((delta) =>
      formatter
        .formatToParts(new Date(wall + delta))
        .find((p) => p.type === 'timeZoneName')!
        .value.replace('GMT', ''),
    ),
  );
  const matches = [...offsets]
    .map((offset) => new Date(value + ':00' + offset))
    .filter(
      (d) => Number.isFinite(d.getTime()) && torontoLocalInput(d) === value,
    )
    .sort((a, b) => a.getTime() - b.getTime());
  if (!matches.length)
    throw new Error(
      'This Toronto time does not exist because clocks move forward. Choose another time.',
    );
  return matches[0].toISOString();
}
export function isPlace(value: unknown): value is Place {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<Place>;
  return (
    typeof p.id === 'string' &&
    p.id.length > 0 &&
    p.id.length <= 300 &&
    typeof p.name === 'string' &&
    p.name.length > 0 &&
    p.name.length <= 300 &&
    typeof p.lat === 'number' &&
    Number.isFinite(p.lat) &&
    Math.abs(p.lat) <= 90 &&
    typeof p.lon === 'number' &&
    Number.isFinite(p.lon) &&
    Math.abs(p.lon) <= 180
  );
}
export function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}
