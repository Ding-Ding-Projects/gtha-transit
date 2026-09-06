/**
 * Talking to a race room.
 *
 * Secrets travel in headers and are held in this browser's session storage only.
 * They are never put in a URL, because a URL reaches history, logs and anything a
 * link is pasted into.
 */

export type RaceMode = 'race' | 'speedrun';
export type CheckinKind = 'meetup' | 'station' | 'finish';

export type RaceTeam = {
  teamId: string;
  name: string;
  route: unknown;
  distinctRoute: boolean;
};

export type RaceParticipant = {
  participantId: string;
  teamId: string;
  name: string;
  sharing: boolean;
  lat?: number;
  lon?: number;
  positionAt?: string;
};

export type RaceCheckin = {
  teamId: string;
  participantId: string;
  kind: CheckinKind;
  target: string;
  recordedAt: string;
  lat?: number;
  lon?: number;
  distanceMetres?: number;
  photoId?: string;
};

export type RaceView = {
  code: string;
  mode: RaceMode;
  title: string;
  state: string;
  config: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  startedAt: string | null;
  teams: RaceTeam[];
  participants: RaceParticipant[];
  checkins: RaceCheckin[];
};

export type LeaderCredentials = { code: string; leaderSecret: string };
export type ParticipantCredentials = {
  code: string;
  participantId: string;
  participantSecret: string;
  teamId: string;
  name: string;
};

async function call<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload
      ? String((payload as { error: unknown }).error)
      : 'That race request could not be completed.';
    throw new Error(message);
  }
  return payload as T;
}

export const createRace = (input: { mode: RaceMode; title: string; config?: unknown }) =>
  call<LeaderCredentials & { mode: RaceMode; expiresAt: string }>('/api/race', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const viewRace = (code: string) => call<RaceView>(`/api/race/${encodeURIComponent(code)}`);

export const addTeam = (leader: LeaderCredentials, name: string) =>
  call<{ teamId: string; name: string }>(`/api/race/${encodeURIComponent(leader.code)}/teams`, {
    method: 'POST',
    headers: { 'x-race-leader': leader.leaderSecret },
    body: JSON.stringify({ name }),
  });

export const assignRoutes = (
  leader: LeaderCredentials,
  assignments: { teamId: string; route: unknown; routeSignature?: string }[],
) =>
  call<{ assigned: number; duplicated: number }>(`/api/race/${encodeURIComponent(leader.code)}/assign`, {
    method: 'POST',
    headers: { 'x-race-leader': leader.leaderSecret },
    body: JSON.stringify({ assignments }),
  });

export const startRace = (leader: LeaderCredentials) =>
  call<{ startedAt: string }>(`/api/race/${encodeURIComponent(leader.code)}/start`, {
    method: 'POST',
    headers: { 'x-race-leader': leader.leaderSecret },
    body: '{}',
  });

export const joinRace = (code: string, input: { name: string; teamId: string }) =>
  call<Omit<ParticipantCredentials, 'code'>>(`/api/race/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const setSharing = (
  person: ParticipantCredentials,
  input: { sharing: boolean; lat?: number; lon?: number },
) =>
  call<{ sharing: boolean; cleared: boolean }>(`/api/race/${encodeURIComponent(person.code)}/sharing`, {
    method: 'POST',
    headers: { 'x-race-participant': person.participantId, 'x-race-secret': person.participantSecret },
    body: JSON.stringify(input),
  });

export const checkIn = (
  person: ParticipantCredentials,
  input: {
    kind: CheckinKind;
    target: string;
    lat?: number;
    lon?: number;
    distanceMetres?: number;
    photo?: { mime: 'image/jpeg'; bytes: string };
  },
) =>
  call<{ recorded: boolean; photoId: string | null }>(`/api/race/${encodeURIComponent(person.code)}/checkin`, {
    method: 'POST',
    headers: { 'x-race-participant': person.participantId, 'x-race-secret': person.participantSecret },
    body: JSON.stringify(input),
  });

export const photoUrl = (code: string, photoId: string) =>
  `/api/race/${encodeURIComponent(code)}/photo/${encodeURIComponent(photoId)}`;

/** Great-circle metres between two coordinates. */
export function metresBetween(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(toLat - fromLat);
  const dLon = toRadians(toLon - fromLon);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Elapsed time as h:mm:ss, for a running clock. */
export function elapsed(fromIso: string | null, now: number): string {
  if (!fromIso) return '--:--';
  const started = Date.parse(fromIso);
  if (!Number.isFinite(started)) return '--:--';
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/**
 * Re-encode a chosen image to a bounded JPEG.
 *
 * Re-encoding through a canvas is what removes the metadata: the original file's
 * EXIF, including any GPS tag the camera wrote, does not survive being drawn and
 * read back. The result is also bounded in pixels and bytes, because a room
 * refuses anything larger.
 */
export async function reEncodeJpeg(
  file: File,
  options: { maxEdge?: number; maxBytes?: number } = {},
): Promise<{ mime: 'image/jpeg'; bytes: string; byteLength: number }> {
  const maxEdge = options.maxEdge ?? 1280;
  const maxBytes = options.maxBytes ?? 400000;
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot re-encode the photo.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  for (const quality of [0.82, 0.7, 0.6, 0.5, 0.4]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const bytes = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const byteLength = Math.floor((bytes.length * 3) / 4);
    if (byteLength <= maxBytes) return { mime: 'image/jpeg', bytes, byteLength };
  }
  throw new Error('That photo is too large even after re-encoding. Try a smaller image.');
}
