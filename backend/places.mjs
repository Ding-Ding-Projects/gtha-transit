import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const indexPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/stops.json");
const manifestPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/feeds/manifest.json");
const provenancePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/graph-provenance.json");
let cached = null;

async function loadStops() {
  if (!cached) {
    const parsed = JSON.parse(await readFile(indexPath, "utf8"));
    cached = Array.isArray(parsed.stops) ? parsed.stops : [];
  }
  return cached;
}

export async function searchPlaces(query, limit = 20) {
  return rankPlaces(await loadStops(), query, limit);
}

const ignoredTerms = new Set(["and", "at", "the"]);
const roadAliases = new Map([
  ["avenue", "ave"], ["av", "ave"], ["road", "rd"], ["street", "st"],
  ["boulevard", "blvd"], ["drive", "dr"], ["lane", "ln"], ["court", "ct"],
  ["parkway", "pkwy"], ["highway", "hwy"], ["saint", "st"],
]);
const highwayForms = new Set(["hwy", "highway"]);
const saintForms = new Set(["st", "saint"]);
const hubTerms = new Set(["station", "terminal", "airport", "centre", "center"]);

const fold = (value) => String(value ?? "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase();
const tokenize = (value) => fold(value)
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .split(" ")
  .filter((term) => term && !ignoredTerms.has(term))
  .map((term) => roadAliases.get(term) ?? term);
const numeric = (term) => /^\d+$/.test(term);
const highwayContext = (terms, index) => numeric(terms[index - 1] ?? "") || numeric(terms[index + 1] ?? "");

function termForms(terms, index) {
  const term = terms[index];
  const forms = new Set([term]);
  if (highwayForms.has(term)) for (const form of highwayForms) forms.add(form);
  if (saintForms.has(term)) for (const form of saintForms) forms.add(form);
  if ((term === "high" || term === "route") && highwayContext(terms, index)) forms.add("hwy");
  return forms;
}

function termMatch(queryTerms, queryIndex, candidateTerms, candidateIndex) {
  const queryTerm = queryTerms[queryIndex];
  const queryForms = termForms(queryTerms, queryIndex);
  const candidateForms = termForms(candidateTerms, candidateIndex);
  if ([...queryForms].some((form) => candidateForms.has(form))) return 0;
  if (!numeric(queryTerm) && queryTerm.length >= 2 && [...candidateForms].some((form) => form.startsWith(queryTerm))) return 1;
  return null;
}

function bestTermMatch(queryTerms, queryIndex, candidateTerms) {
  let best = null;
  for (let candidateIndex = 0; candidateIndex < candidateTerms.length; candidateIndex += 1) {
    const quality = termMatch(queryTerms, queryIndex, candidateTerms, candidateIndex);
    if (quality !== null && (!best || quality < best.quality || (quality === best.quality && candidateIndex < best.index))) best = { quality, index: candidateIndex };
  }
  return best;
}

function exactPhraseIndex(queryTerms, candidateTerms) {
  for (let start = 0; start <= candidateTerms.length - queryTerms.length; start += 1) {
    if (queryTerms.every((_, queryIndex) => termMatch(queryTerms, queryIndex, candidateTerms, start + queryIndex) === 0)) return start;
  }
  return -1;
}

export function rankPlaces(stops, query, limit = 20) {
  const rawQuery = String(query ?? "");
  const tokens = tokenize(rawQuery);
  const boundedLimit = Math.max(0, Math.min(20, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 20));
  if (!Array.isArray(stops) || !tokens.length || tokens.length > 12 || rawQuery.length > 120 || !boundedLimit) return [];
  const score = (stop) => {
    const nameTerms = tokenize(stop.name); const agencyTerms = tokenize(stop.agency); const codeTerms = tokenize(stop.code);
    const fields = [nameTerms, agencyTerms, codeTerms];
    if (!tokens.every((_, index) => fields.some((terms) => bestTermMatch(tokens, index, terms) !== null))) return null;
    const nameMatches = tokens.map((_, index) => bestTermMatch(tokens, index, nameTerms));
    const allNameTermsMatch = nameMatches.every(Boolean);
    const allNameTermsExact = allNameTermsMatch && nameMatches.every((match) => match.quality === 0);
    const exact = allNameTermsExact && nameTerms.length === tokens.length;
    const forwardPhraseIndex = allNameTermsExact ? exactPhraseIndex(tokens, nameTerms) : -1;
    const reversePhraseIndex = allNameTermsExact ? exactPhraseIndex([...tokens].reverse(), nameTerms) : -1;
    const phraseIndex = [forwardPhraseIndex, reversePhraseIndex].filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? -1;
    const hub = nameTerms.some((term) => hubTerms.has(term));
    const exactAgency = agencyTerms.length === tokens.length && tokens.every((_, index) => termMatch(tokens, index, agencyTerms, index) === 0);
    const tier = exact ? 0 : allNameTermsExact && hub ? 1 : allNameTermsExact && phraseIndex >= 0 ? 2 : allNameTermsExact ? 3 : allNameTermsMatch ? 4 : exactAgency ? 5 : 6;
    const prefixCount = nameMatches.filter((match) => match?.quality === 1).length;
    const name = nameTerms.join(" "); const agency = agencyTerms.join(" ");
    return [tier, prefixCount, Number(stop.locationType) === 1 ? 0 : 1, phraseIndex < 0 ? 999 : phraseIndex, name.length, name, agency, String(stop.id)];
  };
  const compare = (a, b) => { for (let index = 0; index < a.length; index += 1) { const value = typeof a[index] === "number" ? a[index] - b[index] : String(a[index]).localeCompare(String(b[index])); if (value) return value; } return 0; };
  const ranked = stops.map((stop) => ({ stop, score: score(stop) })).filter((item) => item.score !== null).sort((a, b) => compare(a.score, b.score));
  const seen = new Set();
  return ranked.filter(({ stop }) => { const lat = Number(stop.lat); const lon = Number(stop.lon); const location = Number.isFinite(lat) && Number.isFinite(lon) ? `${lat}|${lon}` : `id:${stop.id}`; const key = `${tokenize(stop.name).join(" ")}|${tokenize(stop.agency).join(" ")}|${location}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, boundedLimit).map(({ stop }) => ({
    id: String(stop.id), name: String(stop.name), lat: Number(stop.lat), lon: Number(stop.lon), kind: "stop", feedId: stop.feedId ?? null, locationType: Number(stop.locationType ?? 0), parentStation: stop.parentStation ?? null, ...(stop.agency ? { agency: String(stop.agency) } : {})
  }));
}

export function coverageContextForDate(provenance, date) {
  const unavailableAgencies = groupGraphFeeds(provenance.feeds ?? []).filter((feed) => feed.activeTripsByDate?.[date] === 0).map((feed) => ({ id: feed.id, nextServiceDate: Object.entries(feed.activeTripsByDate).sort(([left], [right]) => left.localeCompare(right)).find(([candidate, count]) => candidate > date && count > 0)?.[0] ?? null }));
  return { date, unavailableAgencies };
}

export function groupGraphFeeds(feeds) {
  const grouped = new Map();
  for (const feed of feeds) {
    const id = feed.publicAgencyId ?? feed.id;
    const current = grouped.get(id) ?? { ...feed, id, activeTripsByDate: {}, sources: [], versions: [] };
    current.serviceStart = [current.serviceStart, feed.serviceStart].filter(Boolean).sort()[0] ?? null;
    current.serviceEnd = [current.serviceEnd, feed.serviceEnd].filter(Boolean).sort().at(-1) ?? null;
    for (const [date, count] of Object.entries(feed.activeTripsByDate ?? {})) current.activeTripsByDate[date] = (current.activeTripsByDate[date] ?? 0) + Number(count);
    const source = feed.publisherDownloadUrl ?? feed.source ?? null;
    if (source && !current.sources.includes(source)) current.sources.push(source);
    current.versions.push({ id: feed.id, sha256: feed.sha256 ?? null, source, serviceStart: feed.serviceStart ?? null, serviceEnd: feed.serviceEnd ?? null, retireAfter: feed.retireAfter ?? null, promoteAfter: feed.promoteAfter ?? null });
    grouped.set(id, current);
  }
  return [...grouped.values()];
}

export function calendarDateInTimeZone(dateTime, timeZone = "America/Toronto") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(dateTime));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function graphProvenance() {
  try { return JSON.parse(await readFile(provenancePath, "utf8")); } catch { return { source: "OpenTripPlanner", graphBuiltAt: null, timezone: "America/Toronto", feeds: [] }; }
}

export async function coverage() {
  const stops = await loadStops();
  let manifest = { generatedAt: null, feeds: [] };
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch {}
  const provenance = await graphProvenance();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: provenance.timezone ?? "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const provenanceFeeds = new Map(groupGraphFeeds(provenance.feeds ?? []).map((feed) => [feed.id, feed]));
  const counts = new Map();
  for (const stop of stops) counts.set(stop.feedId, (counts.get(stop.feedId) ?? 0) + 1);
  const manifestFeeds = new Map();
  for (const feed of manifest.feeds ?? []) { const id = feed.publicAgencyId ?? feed.id; if (!manifestFeeds.has(id) || feed.id === id) manifestFeeds.set(id, { ...feed, id }); }
  const feeds = [...manifestFeeds.values()].map((feed) => { const graphFeed = provenanceFeeds.get(feed.id); const activeTripsToday = graphFeed?.activeTripsByDate?.[today] ?? null; return { id: feed.id, name: feed.name, loaded: Boolean(graphFeed), availableToday: activeTripsToday === null ? null : activeTripsToday > 0, activeTripsToday, activeTripsByDate: graphFeed?.activeTripsByDate ?? {}, indexedStops: counts.get(feed.id) ?? 0, serviceStart: graphFeed?.serviceStart ?? null, serviceEnd: graphFeed?.serviceEnd ?? null, source: feed.source, sources: graphFeed?.sources ?? [], sha256: graphFeed?.sha256 ?? null, versions: graphFeed?.versions ?? [], bytes: feed.bytes, warning: activeTripsToday === 0 ? `No scheduled trips are available for ${today} in the active graph.` : null }; });
  return { generatedAt: provenance.updatedAt, graphBuiltAt: provenance.graphBuiltAt, timezone: provenance.timezone, indexedStops: stops.length, agencies: feeds, feeds, warnings: feeds.filter((feed) => feed.warning).map((feed) => ({ id: feed.id, message: feed.warning })), source: "active OpenTripPlanner graph and validated official GTFS feeds" };
}
