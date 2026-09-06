import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRaceStore, LIMITS } from '../race/store.mjs';

/**
 * A race room is a short-lived game, not an account system. These check the two
 * things that matter: that a room stays bounded and expires, and that nothing a
 * participant can read ever contains a secret or a position they did not share.
 */

const store = (now) => createRaceStore({ directory: mkdtempSync(path.join(tmpdir(), 'race-')), ...(now ? { now } : {}) });
const jpeg = (bytes = 64) => {
  const buffer = Buffer.alloc(bytes, 0x20);
  buffer[0] = 0xff; buffer[1] = 0xd8; buffer[2] = 0xff;
  return buffer.toString('base64');
};

const opened = (races) => {
  const race = races.create({ mode: 'race', title: 'Test race' });
  const red = races.addTeam(race.code, race.leaderSecret, { name: 'Red' });
  const blue = races.addTeam(race.code, race.leaderSecret, { name: 'Blue' });
  return { race, red, blue };
};

test('a race issues a readable join code and a leader secret that is never stored in the clear', () => {
  const races = store();
  const race = races.create({ mode: 'race', title: 'Test' });
  assert.match(race.code, /^[A-Z2-9]{6}$/);
  assert.equal(race.leaderSecret.length > 20, true);
  assert.equal(races.isLeader(race.code, race.leaderSecret), true);
  assert.equal(races.isLeader(race.code, 'not-the-secret'), false);
  assert.equal(JSON.stringify(races.view(race.code)).includes(race.leaderSecret), false);
  races.close();
});

test('only the leader may add a team, assign routes or start the race', () => {
  const races = store();
  const { race, red } = opened(races);
  assert.throws(() => races.addTeam(race.code, 'wrong', { name: 'Gate crashers' }), /leader/);
  assert.throws(() => races.assignRoutes(race.code, 'wrong', []), /leader/);
  assert.throws(() => races.start(race.code, 'wrong'), /leader/);
  assert.equal(races.start(race.code, race.leaderSecret).startedAt.length > 0, true);
  assert.equal(races.view(race.code).state, 'running');
  assert.equal(races.view(race.code).teams.find((team) => team.teamId === red.teamId).name, 'Red');
  races.close();
});

test('distinct routes are preferred, and a repeat is disclosed rather than hidden', () => {
  const races = store();
  const { race, red, blue } = opened(races);
  const result = races.assignRoutes(race.code, race.leaderSecret, [
    { teamId: red.teamId, route: { summary: 'via Line 1' }, routeSignature: 'a' },
    { teamId: blue.teamId, route: { summary: 'via Line 1' }, routeSignature: 'a' },
  ]);
  assert.equal(result.assigned, 2);
  assert.equal(result.duplicated, 1);
  const teams = races.view(race.code).teams;
  assert.deepEqual(teams.map((team) => team.distinctRoute), [true, false]);
  races.close();
});

test('a route assignment cannot name a team from another race', () => {
  const races = store();
  const { race } = opened(races);
  assert.throws(
    () => races.assignRoutes(race.code, race.leaderSecret, [{ teamId: 'not-a-team', route: null }]),
    /not in this race/,
  );
  races.close();
});

test('joining returns a participant secret, and the wrong one is refused', () => {
  const races = store();
  const { race, red } = opened(races);
  const person = races.join(race.code, { name: 'Ada', teamId: red.teamId });
  assert.equal(person.teamId, red.teamId);
  assert.throws(
    () => races.setSharing(race.code, person.participantId, 'wrong', { sharing: true, lat: 43.6, lon: -79.4 }),
    /secret does not match/,
  );
  races.close();
});

test('position sharing is off until turned on, and stopping it clears the position', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'race-'));
  const races = createRaceStore({ directory });
  const { race, red } = opened(races);
  const person = races.join(race.code, { name: 'Ada', teamId: red.teamId });
  assert.equal(races.view(race.code).participants[0].sharing, false);
  assert.equal(races.view(race.code).participants[0].lat, undefined);

  races.setSharing(race.code, person.participantId, person.participantSecret, { sharing: true, lat: 43.6532, lon: -79.3832 });
  const sharing = races.view(race.code).participants[0];
  assert.equal(sharing.sharing, true);
  assert.equal(sharing.lat, 43.6532);

  // Stopping must clear the position even when the client still sends coordinates.
  const stopped = races.setSharing(race.code, person.participantId, person.participantSecret, { sharing: false, lat: 43.6532, lon: -79.3832 });
  assert.equal(stopped.cleared, true);
  const after = races.view(race.code).participants[0];
  assert.equal(after.sharing, false);
  assert.equal(after.lat, undefined);
  assert.equal(JSON.stringify(races.view(race.code)).includes('43.6532'), false);

  // The readable view hides a position for anyone not sharing, so check the row
  // itself: a stopped participant's last position must not be retained at all.
  races.close();
  const db = new DatabaseSync(path.join(directory, 'races.sqlite'));
  const row = db.prepare('SELECT sharing, lat, lon, position_at FROM participants WHERE participant_id = ?').get(person.participantId);
  db.close();
  assert.equal(row.sharing, 0);
  assert.equal(row.lat, null);
  assert.equal(row.lon, null);
  assert.equal(row.position_at, null);
});

test('an impossible coordinate is refused rather than stored', () => {
  const races = store();
  const { race, red } = opened(races);
  const person = races.join(race.code, { name: 'Ada', teamId: red.teamId });
  assert.throws(
    () => races.setSharing(race.code, person.participantId, person.participantSecret, { sharing: true, lat: 200, lon: 0 }),
    /outside the valid range/,
  );
  races.close();
});

test('a check-in is recorded as an observation, with its own time', () => {
  const races = store();
  const { race, red } = opened(races);
  const person = races.join(race.code, { name: 'Ada', teamId: red.teamId });
  races.checkIn(race.code, person.participantId, person.participantSecret, {
    kind: 'station', target: 'Union Station', lat: 43.6452, lon: -79.3806, distanceMetres: 38,
  });
  const [entry] = races.view(race.code).checkins;
  assert.equal(entry.kind, 'station');
  assert.equal(entry.target, 'Union Station');
  assert.equal(entry.distanceMetres, 38);
  assert.equal(entry.teamId, red.teamId);
  assert.equal(typeof entry.recordedAt, 'string');
  races.close();
});

test('an unknown check-in kind and an empty target are both refused', () => {
  const races = store();
  const { race, red } = opened(races);
  const person = races.join(race.code, { name: 'Ada', teamId: red.teamId });
  const call = (options) => races.checkIn(race.code, person.participantId, person.participantSecret, options);
  assert.throws(() => call({ kind: 'teleport', target: 'Union' }), /Unknown check-in kind/);
  assert.throws(() => call({ kind: 'station', target: '   ' }), /needs a target/);
  races.close();
});

test('only a re-encoded JPEG is accepted, and it never appears in the readable view', () => {
  const races = store();
  const { race, red } = opened(races);
  const person = races.join(race.code, { name: 'Ada', teamId: red.teamId });
  const call = (photo) => races.checkIn(race.code, person.participantId, person.participantSecret, {
    kind: 'station', target: 'Union Station', photo,
  });
  assert.throws(() => call({ mime: 'image/png', bytes: jpeg() }), /re-encoded JPEG/);
  assert.throws(() => call({ mime: 'image/jpeg', bytes: Buffer.from('not a jpeg').toString('base64') }), /not a JPEG/);
  assert.throws(() => call({ mime: 'image/jpeg', bytes: '' }), /empty/);
  assert.throws(
    () => call({ mime: 'image/jpeg', bytes: jpeg(LIMITS.maxPhotoBytes + 10) }),
    /exceeds the safety bound/,
  );

  const accepted = call({ mime: 'image/jpeg', bytes: jpeg() });
  assert.equal(typeof accepted.photoId, 'string');
  const view = races.view(race.code);
  assert.equal(view.checkins[0].photoId, accepted.photoId);
  assert.equal(JSON.stringify(view).includes(jpeg().slice(0, 16)), false);
  const stored = races.photo(race.code, accepted.photoId);
  assert.equal(stored.mime, 'image/jpeg');
  assert.equal(stored.bytes[0], 0xff);
  races.close();
});

test('a photo from another race is never returned', () => {
  const races = store();
  const first = opened(races);
  const second = opened(races);
  const person = races.join(first.race.code, { name: 'Ada', teamId: first.red.teamId });
  const saved = races.checkIn(first.race.code, person.participantId, person.participantSecret, {
    kind: 'station', target: 'Union', photo: { mime: 'image/jpeg', bytes: jpeg() },
  });
  assert.equal(races.photo(second.race.code, saved.photoId), null);
  races.close();
});

test('a race is bounded in teams', () => {
  const races = store();
  const race = races.create({ mode: 'speedrun', title: 'Speed run' });
  for (let index = 0; index < LIMITS.maxTeams; index += 1) {
    races.addTeam(race.code, race.leaderSecret, { name: `Team ${index}` });
  }
  assert.throws(() => races.addTeam(race.code, race.leaderSecret, { name: 'One too many' }), /maximum number of teams/);
  races.close();
});

test('an expired race is gone, and its photos and check-ins go with it', () => {
  let clock = Date.parse('2026-09-06T12:00:00.000Z');
  const races = createRaceStore({ directory: mkdtempSync(path.join(tmpdir(), 'race-')), now: () => clock });
  const race = races.create({ mode: 'race', title: 'Short', lifetimeMs: 60000 });
  const team = races.addTeam(race.code, race.leaderSecret, { name: 'Red' });
  const person = races.join(race.code, { name: 'Ada', teamId: team.teamId });
  races.checkIn(race.code, person.participantId, person.participantSecret, {
    kind: 'station', target: 'Union', photo: { mime: 'image/jpeg', bytes: jpeg() },
  });
  clock += 120000;
  assert.throws(() => races.view(race.code), /expired/);
  assert.equal(races.purge() >= 1, true);
  assert.throws(() => races.view(race.code), /No race exists/);
  races.close();
});

test('an unknown mode and an unknown code are both refused', () => {
  const races = store();
  assert.throws(() => races.create({ mode: 'marathon' }), /Unknown race mode/);
  assert.throws(() => races.view('NOPE12'), /No race exists/);
  races.close();
});

test('a name is trimmed, bounded and stripped of control characters', () => {
  const races = store();
  const race = races.create({ mode: 'race', title: 'x' });
  const team = races.addTeam(race.code, race.leaderSecret, { name: `  Red${String.fromCharCode(9)}Team   ` });
  assert.equal(team.name, 'Red Team');
  const long = races.addTeam(race.code, race.leaderSecret, { name: 'z'.repeat(200) });
  assert.equal(long.name.length, LIMITS.maxNameLength);
  races.close();
});
