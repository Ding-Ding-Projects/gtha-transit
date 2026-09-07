import http from "node:http";
import { readFile } from "node:fs/promises";

const keyFile = process.env.METROLINX_KEY_FILE ?? "/run/secrets/metrolinx-api-key";
const sources = new Map([
  // Every feed path carries `Gtfs.proto`. The `Gtfs` spelling also answers 200,
  // with the same data as JSON, which a protobuf reader cannot parse - so the
  // wrong path fails as an unreadable payload rather than as a missing endpoint.
  ["/internal/metrolinx/go/trips", "https://api.openmetrolinx.com/OpenDataAPI/api/V1/Gtfs.proto/Feed/TripUpdates"],
  ["/internal/metrolinx/go/alerts", "https://api.openmetrolinx.com/OpenDataAPI/api/V1/Gtfs.proto/Feed/Alerts"],
  ["/internal/metrolinx/go/vehicles", "https://api.openmetrolinx.com/OpenDataAPI/api/V1/Gtfs.proto/Feed/VehiclePosition"],
  ["/internal/metrolinx/up/trips", "https://api.openmetrolinx.com/OpenDataAPI/api/V1/UP/Gtfs.proto/Feed/TripUpdates"],
  ["/internal/metrolinx/up/alerts", "https://api.openmetrolinx.com/OpenDataAPI/api/V1/UP/Gtfs.proto/Feed/Alerts"],
  ["/internal/metrolinx/up/vehicles", "https://api.openmetrolinx.com/OpenDataAPI/api/V1/UP/Gtfs.proto/Feed/VehiclePosition"]
]);
const cache = new Map();
const status = new Map();
function entityCount(body) {
  let offset = 0; let count = 0;
  const varint = () => { let value = 0; let shift = 0; while (offset < body.length) { const byte = body[offset++]; value += (byte & 127) * 2 ** shift; if (!(byte & 128)) return value; shift += 7; if (shift > 49) throw new Error("protobuf varint invalid"); } throw new Error("protobuf truncated"); };
  while (offset < body.length) {
    const tag = varint(); const field = Math.floor(tag / 8); const wire = tag & 7;
    if (wire === 0) varint();
    else if (wire === 1) offset += 8;
    else if (wire === 2) { const length = varint(); if (field === 2) count += 1; offset += length; }
    else if (wire === 5) offset += 4;
    else throw new Error("protobuf wire type unsupported");
    if (offset > body.length) throw new Error("protobuf truncated");
  }
  return count;
}
/**
 * Does this payload begin like a GTFS-Realtime FeedMessage?
 *
 * Field 1 is the header and is length-delimited, so a real feed starts with the
 * tag byte 0x0a. JSON starts `{` or `[`, and an error page starts `<`, which is
 * how the wrong endpoint spelling is caught before anything is cached.
 */
export function looksLikeFeed(body) {
  return body.length > 2 && body[0] === 0x0a;
}

async function apiKey() {
  const value = (await readFile(keyFile, "utf8")).trim();
  if (!value) throw new Error("credential unavailable");
  return value;
}
async function load(pathname) {
  const hit = cache.get(pathname);
  if (hit && Date.now() - hit.time < 15000) return hit.body;
  const source = new URL(sources.get(pathname));
  source.searchParams.set("key", await apiKey());
  const response = await fetch(source, { headers: { accept: "application/x-google-protobuf, application/x-protobuf" }, signal: AbortSignal.timeout(20000), redirect: "error" });
  if (!response.ok) throw new Error("upstream unavailable");
  const body = Buffer.from(await response.arrayBuffer());
  if (!body.length || body.length > 64 * 1024 * 1024) throw new Error("upstream payload invalid");
  // A 200 that is not a protobuf feed is a different fault from an unreachable one,
  // and must not be reported as the same thing. Asking the wrong path returns the
  // same data as JSON, so without this check that mistake looks exactly like the
  // operator refusing the request.
  if (!looksLikeFeed(body)) throw new Error("upstream returned a non-protobuf payload");
  cache.set(pathname, { time: Date.now(), body });
  status.set(pathname, { lastSuccessfulFetch: new Date().toISOString(), entityCount: entityCount(body) });
  return body;
}
/** The proxy server, created only when this module is the program being run. */
export function createProxyServer() {
  return http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/internal/metrolinx/status") {
      // An unreadable credential file is not the same as no credential, and saying
      // "not configured" for one that is present but refused sends the next person
      // looking for a key that is already there.
      let configured = false; let credential = "absent";
      try { configured = Boolean(await apiKey()); credential = "readable"; }
      catch (cause) { credential = cause && cause.code === "EACCES" ? "present-but-unreadable" : cause && cause.code === "ENOENT" ? "absent" : "unreadable"; }
      const agencies = ["go", "up"].map((id) => {
        const trips = status.get(`/internal/metrolinx/${id}/trips`); const alerts = status.get(`/internal/metrolinx/${id}/alerts`);
        const vehicles = status.get(`/internal/metrolinx/${id}/vehicles`);
        return { id, state: trips ? "live" : configured ? "waiting" : credential === "present-but-unreadable" ? "credential_unreadable" : "not_configured", capabilities: ["trip_updates", "vehicle_positions", "service_alerts"], lastSuccessfulFetch: trips?.lastSuccessfulFetch ?? null, entityCount: trips?.entityCount ?? null, vehiclesLastSuccessfulFetch: vehicles?.lastSuccessfulFetch ?? null, vehiclesEntityCount: vehicles?.entityCount ?? null, alertsLastSuccessfulFetch: alerts?.lastSuccessfulFetch ?? null, alertsEntityCount: alerts?.entityCount ?? null };
      });
      const body = Buffer.from(JSON.stringify({ configured, credential, agencies }));
      res.writeHead(200, { "content-type": "application/json", "content-length": body.length, "cache-control": "no-store" }).end(body); return;
    }
    if (req.method !== "GET" || !sources.has(req.url)) { res.writeHead(404).end(); return; }
    const body = await load(req.url);
    res.writeHead(200, { "content-type": "application/x-google-protobuf", "content-length": body.length, "cache-control": "private, max-age=10" });
    res.end(body);
  } catch { res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end("live transit data unavailable"); }
  });
}

// Importing this module must not open a port, so a test can read its rules.
if (process.argv[1] && process.argv[1].endsWith("metrolinx-proxy.mjs")) createProxyServer().listen(8788, "0.0.0.0");

