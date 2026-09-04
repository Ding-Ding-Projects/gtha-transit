import http from "node:http";
import { readFile } from "node:fs/promises";

const keyFile = process.env.METROLINX_KEY_FILE ?? "/run/secrets/metrolinx-api-key";
const sources = new Map([
  ["/internal/metrolinx/go/trips", "https://api.openmetrolinx.com/OpenDataAPI/api/V1/Gtfs/Feed/TripUpdates"],
  ["/internal/metrolinx/go/alerts", "https://api.openmetrolinx.com/OpenDataAPI/api/V1/Gtfs/Feed/Alerts"],
  ["/internal/metrolinx/up/trips", "https://api.openmetrolinx.com/OpenDataAPI/api/V1/UP/Gtfs.proto/Feed/TripUpdates"],
  ["/internal/metrolinx/up/alerts", "https://api.openmetrolinx.com/OpenDataAPI/api/V1/UP/Gtfs.proto/Feed/Alerts"]
]);
const cache = new Map();
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
  cache.set(pathname, { time: Date.now(), body });
  return body;
}
http.createServer(async (req, res) => {
  try {
    if (req.method !== "GET" || !sources.has(req.url)) { res.writeHead(404).end(); return; }
    const body = await load(req.url);
    res.writeHead(200, { "content-type": "application/x-google-protobuf", "content-length": body.length, "cache-control": "private, max-age=10" });
    res.end(body);
  } catch { res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end("live transit data unavailable"); }
}).listen(8788, "0.0.0.0");
