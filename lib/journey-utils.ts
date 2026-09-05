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
/** Keep independently cleared native fields incomplete until both are supplied. */
export function updateTorontoInputPart(
  value: string,
  part: 'date' | 'time',
  next: string,
): string {
  const [date = '', time = ''] = value.split('T');
  return part === 'date' ? `${next}T${time}` : `${date}T${next}`;
}

/** Advance a Toronto calendar date, not a 24-hour interval across a clock change. */
export function torontoTomorrowAtNine(now: Date = new Date()): string {
  const calendar = new Date(torontoLocalInput(now).slice(0, 10) + 'T00:00:00Z');
  calendar.setUTCDate(calendar.getUTCDate() + 1);
  return calendar.toISOString().slice(0, 10) + 'T09:00';
}

function validWallTime(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$/.test(value)) return false;
  const wall = new Date(value + ':00Z');
  return Number.isFinite(wall.getTime()) && wall.toISOString().slice(0, 16) === value;
}

/** Reject skipped local times. Repeated local times choose the earlier occurrence. */
export function torontoIso(value: string): string {
  if (!validWallTime(value))
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

/** Retain a shared or stepped instant only while it still describes the visible fields. */
export function resolveTorontoTime(value: string, instant?: string): string {
  const fallback = torontoIso(value);
  if (!instant) return fallback;
  const parts = /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2})(?::([0-9]{2})(?:[.][0-9]{1,9})?)?(Z|[+-][0-9]{2}:[0-9]{2})$/.exec(instant);
  if (!parts || !validWallTime(parts[1]) || Number(parts[2] || 0) > 59) return fallback;
  const parsed = new Date(instant);
  return Number.isFinite(parsed.getTime()) && torontoLocalInput(parsed) === value
    ? parsed.toISOString()
    : fallback;
}

/** Move by elapsed minutes and retain the instant through the repeated local hour. */
export function shiftTorontoTime(
  value: string,
  minutes: number,
  instant?: string,
): { local: string; instant: string } {
  if (!Number.isFinite(minutes) || !Number.isInteger(minutes))
    throw new Error('Choose a whole number of minutes.');
  const shifted = new Date(Date.parse(resolveTorontoTime(value, instant)) + minutes * 60000);
  const local = torontoLocalInput(shifted);
  const result = shifted.toISOString();
  if (!validWallTime(local)) throw new Error('Choose a valid Toronto date and time.');
  return { local, instant: result };
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
