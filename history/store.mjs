import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MAX_TEXT = 2000;
const MAX_QUERY = 200;
const MAX_LIMIT = 100;
const clean = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
const json = (value) => JSON.stringify(value, Object.keys(value ?? {}).sort());
const hash = (value) => { let h = 2166136261; for (const c of value) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); };

function dayBoundary(value, end = false) {
  if (value == null || value === '') return undefined;
  const raw = String(value);
  if (!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(raw)) throw new Error('Date filters must use ISO date or timestamp');
  let d;
  if (raw.length === 10) {
    // Interpret calendar dates in Toronto, including DST, then serialize UTC.
    const [year, month, day] = raw.split('-').map(Number);
    let guess = Date.UTC(year, month - 1, day);
    for (let i = 0; i < 2; i++) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', timeZoneName: 'longOffset', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
      const zone = parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT-05:00';
      const match = zone.match(/GMT([+-])(\d{2}):?(\d{2})?/);
      const offset = match ? (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3] || 0)) * 60000 : -18000000;
      guess = Date.UTC(year, month - 1, day) - offset;
    }
    d = new Date(guess);
  } else d = new Date(raw);
  if (!Number.isFinite(d.getTime())) throw new Error('Date filter is invalid');
  return d.toISOString();
}

function normalize(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('History snapshot is invalid');
  const source = clean(snapshot.sourceUrl || 'unknown');
  const observedAt = new Date(snapshot.fetchedAt || Date.now());
  if (!Number.isFinite(observedAt.getTime())) throw new Error('History snapshot timestamp is invalid');
  const alerts = Array.isArray(snapshot.alerts) ? snapshot.alerts : [];
  const lines = new Map((Array.isArray(snapshot.lines) ? snapshot.lines : []).map((line) => [clean(line.id), line]));
  const records = [];
  for (const item of alerts) {
    if (!item || typeof item !== 'object') continue;
    const id = clean(item.id);
    if (!id) continue;
    const routeIds = [...new Set((item.lines || item.routeIds || linesFor(item, lines)).map(clean).filter(Boolean))].sort();
    const payload = { id, title: clean(item.title), description: clean(item.description), url: clean(item.url), updatedAt: clean(item.updatedAt), activeFrom: clean(item.activeFrom), activeTo: clean(item.activeTo), lines: routeIds };
    records.push({ key: `${source}:${id}`, source, id, observedAt: observedAt.toISOString(), payload, routes: routeIds });
  }
  return { source, observedAt: observedAt.toISOString(), state: snapshot.state, records };
}
function linesFor(item, lines) {
  return [...lines.values()].filter((line) => (line.alerts || []).some((a) => a?.id === item.id)).map((line) => line.id);
}

export function createHistoryStore({ directory }) {
  if (!directory || typeof directory !== 'string') throw new Error('History directory is required');
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'disruptions.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  db.exec(`CREATE TABLE IF NOT EXISTS occurrences (
    occurrence_id INTEGER PRIMARY KEY,
    source TEXT NOT NULL, alert_id TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active','no_longer_reported')), resolved_at TEXT,
    UNIQUE(source, alert_id, first_seen)
  );
  CREATE TABLE IF NOT EXISTS versions (
    version_id INTEGER PRIMARY KEY, occurrence_id INTEGER NOT NULL REFERENCES occurrences(occurrence_id),
    observed_at TEXT NOT NULL, payload_hash TEXT NOT NULL, payload_json TEXT NOT NULL,
    UNIQUE(occurrence_id, payload_hash)
  );
  CREATE TABLE IF NOT EXISTS occurrence_lines (
    occurrence_id INTEGER NOT NULL REFERENCES occurrences(occurrence_id), line_id TEXT NOT NULL,
    PRIMARY KEY(occurrence_id, line_id)
  );
  CREATE INDEX IF NOT EXISTS occurrences_seen ON occurrences(first_seen, occurrence_id);
  CREATE INDEX IF NOT EXISTS versions_observed ON versions(observed_at);
  CREATE INDEX IF NOT EXISTS occurrence_lines_line ON occurrence_lines(line_id);`);
  const find = db.prepare('SELECT * FROM occurrences WHERE source = ? AND alert_id = ? AND status = \'active\' ORDER BY occurrence_id DESC LIMIT 1');
  const insertOccurrence = db.prepare('INSERT INTO occurrences(source,alert_id,first_seen,last_seen,status,resolved_at) VALUES(?,?,?,?,?,NULL)');
  const updateSeen = db.prepare('UPDATE occurrences SET last_seen=?, status=\'active\', resolved_at=NULL WHERE occurrence_id=?');
  const addVersion = db.prepare('INSERT OR IGNORE INTO versions(occurrence_id,observed_at,payload_hash,payload_json) VALUES(?,?,?,?)');
  const addLine = db.prepare('INSERT OR IGNORE INTO occurrence_lines(occurrence_id,line_id) VALUES(?,?)');
  function observe(snapshot) {
    const data = normalize(snapshot);
    if (data.state !== 'live') return { observed: false, reason: 'snapshot-not-live', count: data.records.length };
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DROP TABLE IF EXISTS _seen_history; CREATE TEMP TABLE _seen_history(occurrence_id INTEGER PRIMARY KEY)');
      for (const record of data.records) {
        let occurrence = find.get(record.source, record.id);
        if (!occurrence) { const result = insertOccurrence.run(record.source, record.id, record.observedAt, record.observedAt, 'active'); occurrence = { occurrence_id: Number(result.lastInsertRowid) }; }
        updateSeen.run(record.observedAt, occurrence.occurrence_id);
        db.prepare('INSERT OR IGNORE INTO _seen_history VALUES(?)').run(occurrence.occurrence_id);
        const payloadJson = JSON.stringify(record.payload);
        addVersion.run(occurrence.occurrence_id, record.observedAt, hash(payloadJson), payloadJson);
        for (const line of record.routes) addLine.run(occurrence.occurrence_id, line);
      }
      // A missing alert is meaningful only when this exact source gave a complete live snapshot.
      db.prepare('UPDATE occurrences SET status=\'no_longer_reported\' WHERE source=? AND status=\'active\' AND occurrence_id NOT IN (SELECT occurrence_id FROM _seen_history)').run(data.source);
      db.exec('COMMIT');
      return { observed: true, count: data.records.length };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function query({ from, to, line, q, limit = 50, cursor } = {}) {
    if (Number(limit) > MAX_LIMIT) throw new Error(`Query limit must be at most ${MAX_LIMIT}`);
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), MAX_LIMIT);
    const needle = clean(q).slice(0, MAX_QUERY).toLowerCase();
    const clauses = []; const params = [];
    if (from != null) { clauses.push('o.first_seen >= ?'); params.push(dayBoundary(from)); }
    if (to != null) { clauses.push('o.first_seen < ?'); params.push(dayBoundary(to, true)); }
    if (line) { clauses.push('EXISTS (SELECT 1 FROM occurrence_lines l WHERE l.occurrence_id=o.occurrence_id AND l.line_id=?)'); params.push(clean(line)); }
    if (needle) { clauses.push('lower(v.payload_json) LIKE ?'); params.push(`%${needle}%`); }
    if (cursor) { const decoded = Buffer.from(String(cursor), 'base64url').toString(); const [date, id] = decoded.split('|'); if (!date || !/^\d+$/.test(id)) throw new Error('Cursor is invalid'); clauses.push('(o.first_seen > ? OR (o.first_seen = ? AND o.occurrence_id > ?))'); params.push(date, date, Number(id)); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT o.*, v.payload_json, v.observed_at AS version_observed_at, v.payload_hash FROM occurrences o JOIN versions v ON v.version_id=(SELECT vv.version_id FROM versions vv WHERE vv.occurrence_id=o.occurrence_id ORDER BY vv.version_id DESC LIMIT 1) ${where} ORDER BY o.first_seen ASC, o.occurrence_id ASC LIMIT ?`).all(...params, safeLimit + 1);
    const hasMore = rows.length > safeLimit; if (hasMore) rows.pop();
    return { items: rows.map((row) => ({ occurrenceId: row.occurrence_id, source: row.source, alertId: row.alert_id, firstSeen: row.first_seen, lastSeen: row.last_seen, status: row.status, resolvedAt: row.resolved_at, versionObservedAt: row.version_observed_at, versionHash: row.payload_hash, payload: JSON.parse(row.payload_json), versions: db.prepare('SELECT observed_at AS observedAt, payload_hash AS hash, payload_json AS payload FROM versions WHERE occurrence_id=? ORDER BY version_id ASC').all(row.occurrence_id).map((v) => ({ ...v, payload: JSON.parse(v.payload) })) })), nextCursor: hasMore && rows.length ? Buffer.from(`${rows.at(-1).first_seen}|${rows.at(-1).occurrence_id}`).toString('base64url') : null };
  }
  function close() { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } finally { db.close(); } }
  return { observe, query, close };
}

export const HISTORY_LIMITS = Object.freeze({ maxQuery: MAX_QUERY, maxLimit: MAX_LIMIT });
