const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function text(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }

function agencyKey(value) { return text(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "") ?? null; }

function localParts(at, timeZone) {
  try {
    const values = new Intl.DateTimeFormat("en-US", {
      timeZone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date(at)).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    const weekday = WEEKDAYS.indexOf(values.weekday.toLowerCase());
    if (weekday < 0) return null;
    return { weekday, date: `${values.year}-${values.month}-${values.day}`, minutes: Number(values.hour) * 60 + Number(values.minute) };
  } catch { return null; }
}

function previousDate(date) {
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() - 1);
  return instant.toISOString().slice(0, 10);
}

function weekdayForDate(date) { return new Date(`${date}T12:00:00Z`).getUTCDay(); }

function minutes(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function periods(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.periods)) return value.periods;
  if (text(value?.opens ?? value?.open) && text(value?.closes ?? value?.close)) return [{ open: value.opens ?? value.open, close: value.closes ?? value.close, endsNextDay: value.endsNextDay }];
  return [];
}

function exceptionFor(hours, date) {
  const exceptions = hours?.exceptions ?? hours?.datedExceptions ?? [];
  return Array.isArray(exceptions) ? exceptions.find((exception) => exception?.date === date) ?? null : null;
}

function weeklyScheduleFor(hours, date) {
  const weekly = hours?.weekly ?? hours?.weeklyHours;
  if (!weekly || typeof weekly !== "object") return { known: false, closed: false, periods: [] };
  const day = WEEKDAYS[weekdayForDate(date)];
  if (Array.isArray(weekly)) {
    const matched = weekly.filter((record) => Array.isArray(record?.days) && record.days.map((item) => String(item).toLowerCase().slice(0, 3)).includes(day));
    return matched.length ? { known: true, closed: false, periods: matched.flatMap(periods) } : { known: false, closed: false, periods: [] };
  }
  const value = weekly[day] ?? weekly[day.toUpperCase()] ?? weekly[String(weekdayForDate(date))];
  if (value === undefined || value === null) return { known: false, closed: false, periods: [] };
  if (value === "closed") return { known: true, closed: true, periods: [] };
  return { known: true, closed: false, periods: periods(value) };
}

function scheduleFor(hours, date) {
  const exception = exceptionFor(hours, date);
  if (!exception) return weeklyScheduleFor(hours, date);
  if (exception.closed === true || exception.status === "closed") return { known: true, closed: true, periods: [] };
  const replacement = exception.hours ?? exception.openingHours ?? exception.periods;
  if (replacement) return { known: true, closed: false, periods: periods(replacement) };
  if (exception.status !== "modified") return weeklyScheduleFor(hours, date);
  const base = weeklyScheduleFor(hours, date);
  if (!base.known || base.closed) return base;
  const open = exception.opens ?? exception.open;
  const close = exception.closes ?? exception.close;
  if (!text(open) && !text(close)) return base;
  const hasEndsNextDay = Object.hasOwn(exception, "endsNextDay") && typeof exception.endsNextDay === "boolean";
  return { known: true, closed: false, periods: base.periods.map((period) => ({ ...period, ...(text(open) ? { open } : {}), ...(text(close) ? { close } : {}), ...(hasEndsNextDay ? { endsNextDay: exception.endsNextDay } : {}) })) };
}

function contains(period, minute, carryOver = false) {
  const open = minutes(period?.open ?? period?.start);
  const close = minutes(period?.close ?? period?.end);
  if (open === null || close === null || open === close) return false;
  if (open < close && period?.endsNextDay !== true) return !carryOver && minute >= open && minute < close;
  return carryOver ? minute < close : minute >= open;
}

/** Returns confirmed availability only for explicit, evaluable local schedules. */
export function facilityAvailability(facility, at = new Date()) {
  const hours = facility?.hours ?? facility?.openingHours;
  const timeZone = text(hours?.timeZone) ?? text(hours?.timezone) ?? text(facility?.timeZone) ?? text(facility?.timezone);
  if (!hours || !timeZone || ["unknown", "unavailable", "unsupported"].includes(String(hours.status ?? "").toLowerCase())) return "unknown";
  const local = localParts(at, timeZone);
  if (!local) return "unknown";
  const today = scheduleFor(hours, local.date);
  const yesterday = scheduleFor(hours, previousDate(local.date));
  if (today.closed) return "closed";
  if (!today.known && !yesterday.known) return "unknown";
  const openToday = today.periods.some((period) => contains(period, local.minutes));
  const openFromYesterday = yesterday.periods.some((period) => contains(period, local.minutes, true));
  return openToday || openFromYesterday ? "confirmed-open" : "closed";
}

function identifiers(value) {
  const nested = value?.identity ?? value?.station ?? value?.stationIdentity ?? {};
  const list = (candidate) => Array.isArray(candidate) ? candidate : [];
  return new Set([value?.id, value?.stopId, value?.stationId, value?.gtfsId, nested?.id, nested?.stopId, nested?.stationId, nested?.gtfsId, ...list(value?.ids), ...list(value?.stopIds), ...list(value?.stationIds)].map(text).filter(Boolean));
}

function coordinateIdentity(value) {
  const point = value?.sourceCoordinateIdentity ?? value?.sourceCoordinates ?? value?.coordinates;
  const latitude = Number(point?.lat ?? point?.latitude ?? value?.sourceLat);
  const longitude = Number(point?.lon ?? point?.lng ?? point?.longitude ?? value?.sourceLon);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? `${latitude},${longitude}` : null;
}

/** Matches only an agency-qualified, verified stop or station identifier. Names are never identities. */
export function matchWashroom(place, facilities, { agencyId = null, at = new Date() } = {}) {
  const placeAgency = agencyKey(agencyId ?? place?.agencyId ?? place?.agencyFeedId ?? place?.feedId ?? place?.agency?.id);
  const placeIds = identifiers(place);
  const placeCoordinate = coordinateIdentity(place);
  if (!placeAgency || (!placeIds.size && !placeCoordinate) || !Array.isArray(facilities)) return null;
  const matches = facilities.filter((facility) => {
    const facilityAgency = agencyKey(facility?.agencyId ?? facility?.agencyFeedId ?? facility?.agency?.id ?? facility?.stationIdentity?.agencyId);
    const sameId = [...placeIds].some((id) => identifiers(facility).has(id));
    return facilityAgency === placeAgency && (sameId || (placeCoordinate && placeCoordinate === coordinateIdentity(facility)));
  });
  if (matches.length !== 1) return null;
  const facility = matches[0];
  return { ...facility, availability: facilityAvailability(facility, at) };
}
