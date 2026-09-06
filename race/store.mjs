import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

/**
 * Race rooms. Deliberately small and bounded: a room is a short-lived game, not
 * an account system. Every limit below is enforced on write so a room cannot grow
 * without end, and expired rooms are purged before any new one is created.
 */
export const LIMITS = Object.freeze({
  maxOpenRaces: 200,
  maxTeams: 12,
  maxParticipants: 60,
  maxCheckins: 600,
  maxNameLength: 40,
  maxTargetLength: 120,
  maxRouteBytes: 20000,
  maxPhotoBytes: 400000,
  maxPhotosPerRace: 120,
  defaultLifetimeMs: 12 * 60 * 60 * 1000,
  maxLifetimeMs: 48 * 60 * 60 * 1000,
});

export const RACE_MODES = Object.freeze(['race', 'speedrun']);
export const CHECKIN_KINDS = Object.freeze(['meetup', 'station', 'finish']);

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const clean = (value, limit) => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, limit);

function token(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

/** A short code a person can read aloud. Ambiguous letters are left out. */
function joinCode() {
  const raw = randomBytes(8);
  let code = '';
  for (let index = 0; index < 6; index += 1) code += CODE_ALPHABET[raw[index] % CODE_ALPHABET.length];
  return code;
}

function sameSecret(candidate, storedHash) {
  const left = Buffer.from(hash(candidate));
  const right = Buffer.from(String(storedHash ?? ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

function requireFinite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(name + ' must be a finite number');
  return number;
}

function coordinate(lat, lon) {
  if (lat == null && lon == null) return null;
  const latitude = requireFinite(lat, 'Latitude');
  const longitude = requireFinite(lon, 'Longitude');
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error('Coordinates are outside the valid range');
  }
  return { lat: latitude, lon: longitude };
}

export function createRaceStore({ directory, now = () => Date.now() } = {}) {
  if (!directory) throw new Error('A race store directory is required');
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'races.sqlite'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS races (
      code TEXT PRIMARY KEY, mode TEXT NOT NULL, title TEXT NOT NULL,
      leader_hash TEXT NOT NULL, config TEXT NOT NULL, state TEXT NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, started_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS teams (
      code TEXT NOT NULL, team_id TEXT NOT NULL, name TEXT NOT NULL,
      route TEXT, distinct_route INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
      PRIMARY KEY (code, team_id)
    );
    CREATE TABLE IF NOT EXISTS participants (
      code TEXT NOT NULL, participant_id TEXT NOT NULL, team_id TEXT NOT NULL,
      name TEXT NOT NULL, secret_hash TEXT NOT NULL, sharing INTEGER NOT NULL DEFAULT 0,
      lat REAL, lon REAL, position_at INTEGER, joined_at INTEGER NOT NULL,
      PRIMARY KEY (code, participant_id)
    );
    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, team_id TEXT NOT NULL,
      participant_id TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
      recorded_at INTEGER NOT NULL, lat REAL, lon REAL, distance_m REAL, photo_id TEXT
    );
    CREATE TABLE IF NOT EXISTS photos (
      code TEXT NOT NULL, photo_id TEXT NOT NULL, bytes BLOB NOT NULL,
      mime TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (code, photo_id)
    );
    CREATE INDEX IF NOT EXISTS checkins_by_race ON checkins (code, recorded_at);
  `);

  const purge = () => {
    const cutoff = now();
    const expired = db.prepare('SELECT code FROM races WHERE expires_at <= ?').all(cutoff).map((row) => row.code);
    for (const code of expired) {
      db.prepare('DELETE FROM photos WHERE code = ?').run(code);
      db.prepare('DELETE FROM checkins WHERE code = ?').run(code);
      db.prepare('DELETE FROM participants WHERE code = ?').run(code);
      db.prepare('DELETE FROM teams WHERE code = ?').run(code);
      db.prepare('DELETE FROM races WHERE code = ?').run(code);
    }
    return expired.length;
  };

  const raceRow = (code) => db.prepare('SELECT * FROM races WHERE code = ?').get(String(code ?? '').toUpperCase());

  const requireRace = (code) => {
    const row = raceRow(code);
    if (!row) throw new Error('No race exists for that code');
    if (row.expires_at <= now()) throw new Error('That race has expired');
    return row;
  };

  return {
    purge,

    create({ mode, title, config = {}, lifetimeMs } = {}) {
      purge();
      if (!RACE_MODES.includes(mode)) throw new Error('Unknown race mode');
      const open = db.prepare('SELECT COUNT(*) AS total FROM races').get().total;
      if (open >= LIMITS.maxOpenRaces) throw new Error('Too many races are already open');
      const serialisedConfig = JSON.stringify(config ?? {});
      if (serialisedConfig.length > LIMITS.maxRouteBytes) throw new Error('Race configuration exceeds the safety bound');
      const lifetime = Math.min(LIMITS.maxLifetimeMs, Math.max(60000, Number(lifetimeMs) || LIMITS.defaultLifetimeMs));
      const created = now();
      const leaderSecret = token();
      let code = joinCode();
      for (let attempt = 0; attempt < 12 && raceRow(code); attempt += 1) code = joinCode();
      if (raceRow(code)) throw new Error('A free race code could not be allocated');
      db.prepare('INSERT INTO races (code, mode, title, leader_hash, config, state, created_at, expires_at, started_at) VALUES (?,?,?,?,?,?,?,?,NULL)')
        .run(code, mode, clean(title, LIMITS.maxNameLength) || 'Race', hash(leaderSecret), serialisedConfig, 'open', created, created + lifetime);
      return { code, leaderSecret, mode, expiresAt: new Date(created + lifetime).toISOString() };
    },

    isLeader(code, secret) {
      const row = requireRace(code);
      return sameSecret(secret, row.leader_hash);
    },

    addTeam(code, secret, { name } = {}) {
      const row = requireRace(code);
      if (!sameSecret(secret, row.leader_hash)) throw new Error('Only the race leader can add a team');
      const total = db.prepare('SELECT COUNT(*) AS total FROM teams WHERE code = ?').get(row.code).total;
      if (total >= LIMITS.maxTeams) throw new Error('This race already has the maximum number of teams');
      const teamName = clean(name, LIMITS.maxNameLength);
      if (!teamName) throw new Error('A team needs a name');
      const teamId = token(9);
      db.prepare('INSERT INTO teams (code, team_id, name, route, distinct_route, created_at) VALUES (?,?,?,NULL,0,?)')
        .run(row.code, teamId, teamName, now());
      return { teamId, name: teamName };
    },

    assignRoutes(code, secret, assignments) {
      const row = requireRace(code);
      if (!sameSecret(secret, row.leader_hash)) throw new Error('Only the race leader can assign routes');
      if (!Array.isArray(assignments)) throw new Error('Assignments must be a list');
      const teams = db.prepare('SELECT team_id FROM teams WHERE code = ?').all(row.code).map((team) => team.team_id);
      const seen = new Set();
      let duplicated = 0;
      for (const assignment of assignments) {
        const teamId = String(assignment?.teamId ?? '');
        if (!teams.includes(teamId)) throw new Error('An assignment names a team that is not in this race');
        const route = JSON.stringify(assignment?.route ?? null);
        if (route.length > LIMITS.maxRouteBytes) throw new Error('An assigned route exceeds the safety bound');
        const signature = assignment?.routeSignature ? String(assignment.routeSignature) : route;
        const isDistinct = !seen.has(signature);
        if (!isDistinct) duplicated += 1;
        seen.add(signature);
        db.prepare('UPDATE teams SET route = ?, distinct_route = ? WHERE code = ? AND team_id = ?')
          .run(route, isDistinct ? 1 : 0, row.code, teamId);
      }
      return { assigned: assignments.length, duplicated };
    },

    start(code, secret) {
      const row = requireRace(code);
      if (!sameSecret(secret, row.leader_hash)) throw new Error('Only the race leader can start the race');
      const started = now();
      db.prepare('UPDATE races SET state = ?, started_at = ? WHERE code = ?').run('running', started, row.code);
      return { startedAt: new Date(started).toISOString() };
    },

    join(code, { name, teamId } = {}) {
      const row = requireRace(code);
      const total = db.prepare('SELECT COUNT(*) AS total FROM participants WHERE code = ?').get(row.code).total;
      if (total >= LIMITS.maxParticipants) throw new Error('This race is full');
      const person = clean(name, LIMITS.maxNameLength);
      if (!person) throw new Error('A participant needs a name');
      const team = db.prepare('SELECT team_id FROM teams WHERE code = ? AND team_id = ?').get(row.code, String(teamId ?? ''));
      if (!team) throw new Error('That team is not in this race');
      const participantId = token(9);
      const secret = token();
      db.prepare('INSERT INTO participants (code, participant_id, team_id, name, secret_hash, sharing, lat, lon, position_at, joined_at) VALUES (?,?,?,?,?,0,NULL,NULL,NULL,?)')
        .run(row.code, participantId, team.team_id, person, hash(secret), now());
      return { participantId, participantSecret: secret, teamId: team.team_id, name: person };
    },

    /** Sharing is off until the participant turns it on, and stops the moment they stop it. */
    setSharing(code, participantId, secret, { sharing, lat, lon } = {}) {
      const row = requireRace(code);
      const person = db.prepare('SELECT * FROM participants WHERE code = ? AND participant_id = ?').get(row.code, String(participantId ?? ''));
      if (!person) throw new Error('That participant is not in this race');
      if (!sameSecret(secret, person.secret_hash)) throw new Error('That participant secret does not match');
      const on = sharing === true;
      const point = on ? coordinate(lat, lon) : null;
      db.prepare('UPDATE participants SET sharing = ?, lat = ?, lon = ?, position_at = ? WHERE code = ? AND participant_id = ?')
        .run(on ? 1 : 0, point ? point.lat : null, point ? point.lon : null, point ? now() : null, row.code, person.participant_id);
      return { sharing: on, cleared: !on };
    },

    checkIn(code, participantId, secret, { kind, target, lat, lon, distanceMetres, photo } = {}) {
      const row = requireRace(code);
      const person = db.prepare('SELECT * FROM participants WHERE code = ? AND participant_id = ?').get(row.code, String(participantId ?? ''));
      if (!person) throw new Error('That participant is not in this race');
      if (!sameSecret(secret, person.secret_hash)) throw new Error('That participant secret does not match');
      if (!CHECKIN_KINDS.includes(kind)) throw new Error('Unknown check-in kind');
      const label = clean(target, LIMITS.maxTargetLength);
      if (!label) throw new Error('A check-in needs a target');
      const total = db.prepare('SELECT COUNT(*) AS total FROM checkins WHERE code = ?').get(row.code).total;
      if (total >= LIMITS.maxCheckins) throw new Error('This race has recorded the maximum number of check-ins');
      const point = lat == null && lon == null ? null : coordinate(lat, lon);
      let photoId = null;
      if (photo) {
        const bytes = Buffer.isBuffer(photo.bytes) ? photo.bytes : Buffer.from(String(photo.bytes ?? ''), 'base64');
        if (!bytes.length) throw new Error('A submitted photo is empty');
        if (bytes.length > LIMITS.maxPhotoBytes) throw new Error('A submitted photo exceeds the safety bound');
        if (String(photo.mime) !== 'image/jpeg') throw new Error('Only a re-encoded JPEG may be submitted');
        if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) throw new Error('That photo is not a JPEG');
        const photos = db.prepare('SELECT COUNT(*) AS total FROM photos WHERE code = ?').get(row.code).total;
        if (photos >= LIMITS.maxPhotosPerRace) throw new Error('This race has stored the maximum number of photos');
        photoId = token(9);
        db.prepare('INSERT INTO photos (code, photo_id, bytes, mime, created_at) VALUES (?,?,?,?,?)')
          .run(row.code, photoId, bytes, 'image/jpeg', now());
      }
      const distance = distanceMetres == null ? null : requireFinite(distanceMetres, 'Distance');
      db.prepare('INSERT INTO checkins (code, team_id, participant_id, kind, target, recorded_at, lat, lon, distance_m, photo_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(row.code, person.team_id, person.participant_id, kind, label, now(), point ? point.lat : null, point ? point.lon : null, distance, photoId);
      return { recorded: true, photoId };
    },

    photo(code, photoId) {
      const row = requireRace(code);
      const found = db.prepare('SELECT bytes, mime FROM photos WHERE code = ? AND photo_id = ?').get(row.code, String(photoId ?? ''));
      return found ? { bytes: Buffer.from(found.bytes), mime: found.mime } : null;
    },

    /** Everything a participant may see. Secrets and raw photo bytes never appear here. */
    view(code) {
      const row = requireRace(code);
      const teams = db.prepare('SELECT team_id, name, route, distinct_route FROM teams WHERE code = ? ORDER BY created_at').all(row.code)
        .map((team) => ({
          teamId: team.team_id,
          name: team.name,
          route: team.route ? JSON.parse(team.route) : null,
          distinctRoute: team.distinct_route === 1,
        }));
      const participants = db.prepare('SELECT participant_id, team_id, name, sharing, lat, lon, position_at FROM participants WHERE code = ? ORDER BY joined_at').all(row.code)
        .map((person) => ({
          participantId: person.participant_id,
          teamId: person.team_id,
          name: person.name,
          sharing: person.sharing === 1,
          ...(person.sharing === 1 && person.lat != null ? { lat: person.lat, lon: person.lon, positionAt: new Date(person.position_at).toISOString() } : {}),
        }));
      const checkins = db.prepare('SELECT team_id, participant_id, kind, target, recorded_at, lat, lon, distance_m, photo_id FROM checkins WHERE code = ? ORDER BY recorded_at').all(row.code)
        .map((entry) => ({
          teamId: entry.team_id,
          participantId: entry.participant_id,
          kind: entry.kind,
          target: entry.target,
          recordedAt: new Date(entry.recorded_at).toISOString(),
          ...(entry.lat != null ? { lat: entry.lat, lon: entry.lon } : {}),
          ...(entry.distance_m != null ? { distanceMetres: entry.distance_m } : {}),
          ...(entry.photo_id ? { photoId: entry.photo_id } : {}),
        }));
      return {
        code: row.code,
        mode: row.mode,
        title: row.title,
        state: row.state,
        config: JSON.parse(row.config),
        createdAt: new Date(row.created_at).toISOString(),
        expiresAt: new Date(row.expires_at).toISOString(),
        startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
        teams,
        participants,
        checkins,
      };
    },

    close() { db.close(); },
  };
}
