const AGENCY_ALIASES = new Map([["ttcnext", "ttc"]]);
const NON_IDENTITY_LABELS = new Set(["station", "terminal", "subway"]);
const TRANSIT_FACILITY_TYPES = new Set(["transit-station", "transit-terminal"]);

function text(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }

/** Normalizes public and graph-feed agency identifiers without guessing an agency. */
export function canonicalAgencyId(value) {
  const normalized = text(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "") ?? null;
  return normalized ? AGENCY_ALIASES.get(normalized) ?? normalized : null;
}

/** Normalizes only publisher-provided facility and GTFS station labels for load-time resolution. */
export function normalizeOfficialStationAlias(value) {
  const tokens = String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((token) => token && !NON_IDENTITY_LABELS.has(token));
  return tokens.sort().join(" ");
}

function stopRecords(stopIndex) { return Array.isArray(stopIndex) ? stopIndex : Array.isArray(stopIndex?.stops) ? stopIndex.stops : []; }
function qualifiedStopId(stop) {
  const id = text(stop?.id); const graphFeedId = text(stop?.graphFeedId) ?? id?.split(":", 1)[0] ?? null;
  return id && graphFeedId && id.startsWith(`${graphFeedId}:`) ? id : null;
}
function stopAgency(stop) { return canonicalAgencyId(stop?.feedId ?? stop?.graphFeedId ?? qualifiedStopId(stop)?.split(":", 1)[0]); }
function facilityAgency(facility) { return canonicalAgencyId(facility?.agencyId ?? facility?.stationIdentity?.agencyId); }
function trustedIndex(stopIndex) { return /validated\s+official\s+gtfs/i.test(String(stopIndex?.source ?? "")); }
function sourceEvidence(facility, stopIndex, stationIds) {
  return {
    kind: "official-facility-alias-to-validated-stop-index",
    facilitySourceUrl: text(facility?.source),
    facilitySourceReceiptId: text(facility?.sourceReceiptId),
    stopIndexSource: text(stopIndex?.source),
    stationIds
  };
}

function existingStationIds(facility) {
  return [...new Set([...(Array.isArray(facility?.stationIds) ? facility.stationIds : []), facility?.stationIdentity?.stationId, facility?.stationIdentity?.stopId].map(text).filter(Boolean))];
}

/**
 * Resolves official facility aliases to unique GTFS station entries. This runs
 * only against a validated local stop index, never against a user query, route
 * place name, coordinate proximity, or arbitrary external data.
 */
export function resolveFacilityStopIdentities(facilities, stopIndex) {
  const entries = [];
  const unresolved = [];
  const indexTrusted = trustedIndex(stopIndex);
  const stops = stopRecords(stopIndex);
  const sourceFacilities = Array.isArray(facilities) ? facilities : [];
  const augmentedFacilities = sourceFacilities.map((facility) => {
    const agencyId = facilityAgency(facility);
    const aliases = new Set((Array.isArray(facility?.names) ? facility.names : []).map(normalizeOfficialStationAlias).filter(Boolean));
    const supplied = existingStationIds(facility);
    if (!TRANSIT_FACILITY_TYPES.has(String(facility?.facilityType ?? ""))) {
      unresolved.push({ facilityId: text(facility?.facilityId) ?? null, reason: "facility-not-transit-station-or-terminal" });
      return facility;
    }
    if (!indexTrusted || !agencyId || !aliases.size || !text(facility?.source) || !text(facility?.sourceReceiptId)) {
      unresolved.push({ facilityId: text(facility?.facilityId) ?? null, reason: indexTrusted ? "facility-identity-evidence-unavailable" : "stop-index-not-validated" });
      return facility;
    }
    const candidates = stops.filter((stop) => Number(stop?.locationType) === 1 && stopAgency(stop) === agencyId && aliases.has(normalizeOfficialStationAlias(stop?.name)) && qualifiedStopId(stop));
    const byGraphFeed = new Map();
    for (const candidate of candidates) {
      const graphFeedId = text(candidate.graphFeedId) ?? qualifiedStopId(candidate).split(":", 1)[0];
      const group = byGraphFeed.get(graphFeedId) ?? [];
      group.push(candidate); byGraphFeed.set(graphFeedId, group);
    }
    const accepted = [...byGraphFeed.values()].filter((group) => group.length === 1).map(([candidate]) => qualifiedStopId(candidate));
    const stationIds = [...new Set([...supplied, ...accepted])].sort();
    if (!stationIds.length) {
      unresolved.push({ facilityId: text(facility?.facilityId) ?? null, reason: candidates.length ? "official-station-alias-ambiguous" : "official-station-alias-not-found" });
      return facility;
    }
    const evidence = sourceEvidence(facility, stopIndex, stationIds);
    entries.push({ facilityId: text(facility?.facilityId) ?? null, agencyId, stationIds, evidence });
    return {
      ...facility,
      stationIds,
      stationIdentity: {
        agencyId,
        stationIds,
        sourceUrl: evidence.facilitySourceUrl,
        sourceReceiptId: evidence.facilitySourceReceiptId,
        reference: evidence.kind
      }
    };
  });
  return {
    facilities: augmentedFacilities,
    identityMap: {
      schemaVersion: 1,
      source: text(stopIndex?.source),
      entries,
      unresolved
    }
  };
}
