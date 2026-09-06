import type { Place } from './types';
const localFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Toronto',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
/**
 * Assemble the field value from the formatter's own parts rather than from its
 * rendered string. The separator between date and time is an engine decision -
 * some spell it with a plain space, others with a narrow no-break space or a
 * comma - and a single replace of one ASCII space silently produced a value that
 * no native date or time input would accept.
 */
export function torontoLocalInput(value: Date = new Date()): string {
  const parts = new Map(
    localFormatter.formatToParts(value).map((part) => [part.type, part.value]),
  );
  const year = parts.get('year');
  const month = parts.get('month');
  const day = parts.get('day');
  const hour = parts.get('hour');
  const minute = parts.get('minute');
  if (!year || !month || !day || !hour || !minute) {
    throw new Error('Toronto local time could not be formatted on this device.');
  }
  return `${year}-${month}-${day}T${hour === '24' ? '00' : hour}:${minute}`;
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

/** Read a usable UTC offset for this instant, whatever shape the engine reports. */
export function torontoOffset(formatter: Intl.DateTimeFormat, at: Date): string | null {
  const named = formatter
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value;
  const parsed = /GMT([+-])([0-9]{1,2})(?::?([0-9]{2}))?/.exec(named ?? '');
  if (parsed) {
    return `${parsed[1]}${parsed[2].padStart(2, '0')}:${(parsed[3] ?? '00').padStart(2, '0')}`;
  }
  // No usable offset in the name: derive it from the zone's own wall clock.
  const wallParts = new Map(
    localFormatter.formatToParts(at).map((part) => [part.type, part.value]),
  );
  const year = wallParts.get('year');
  const month = wallParts.get('month');
  const day = wallParts.get('day');
  const hour = wallParts.get('hour');
  const minute = wallParts.get('minute');
  if (!year || !month || !day || !hour || !minute) return null;
  const asUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) === 24 ? 0 : Number(hour), Number(minute));
  const totalMinutes = Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
  if (!Number.isFinite(totalMinutes) || Math.abs(totalMinutes) > 14 * 60) return null;
  const sign = totalMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(totalMinutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
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
  // Not every engine supports longOffset. Accept what it does return, normalise a
  // short form such as GMT-4 to -04:00, and fall back to reading the offset from
  // the clock itself rather than asserting a part that may not be there.
  const offsets = new Set(
    [-86400000, 0, 86400000]
      .map((delta) => torontoOffset(formatter, new Date(wall + delta)))
      .filter(Boolean) as string[],
  );
  if (!offsets.size) throw new Error('Choose a valid Toronto date and time.');
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
