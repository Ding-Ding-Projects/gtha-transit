import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { coverage, graphProvenance, searchPlaces } from "./places.mjs";
import { departuresWithOtp, planWithOtp } from "./otp-client.mjs";
import { applyWashroomPreference } from "./washrooms.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(here, "config.json"), "utf8"));
const max = config.maxBodyBytes;
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => {
  let data = "";
  req.on("data", (chunk) => { data += chunk; if (Buffer.byteLength(data) > max) { reject(new Error("request body exceeds limit")); req.destroy(); } });
  req.on("end", () => resolve(data)); req.on("error", reject);
});
const number = (value, name) => { const n = Number(value); if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number`); return n; };
const coordinates = (raw, name) => ({ lat: number(raw?.lat, `${name}.lat`), lon: number(raw?.lon, `${name}.lon`) });
const bounded = (value, name, min, max) => { const n = number(value, name); if (n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}`); return n; };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, service: "gtha-transit-routing" });
    if (req.method === "GET" && url.pathname === "/api/places") return json(res, 200, { places: await searchPlaces(url.searchParams.get("q"), 20) });
    if (req.method === "GET" && url.pathname === "/api/coverage") return json(res, 200, await coverage());
    if (req.method === "GET" && url.pathname === "/api/departures") {
      const stopId = url.searchParams.get("stopId"); if (!stopId) throw new Error("stopId is required");
      return json(res, 200, await departuresWithOtp({ otpUrl: config.otpUrl, timeoutMs: config.requestTimeoutMs, stopId, startTime: url.searchParams.get("startTime"), timeRange: url.searchParams.get("timeRange"), maxResults: config.maxResults }));
    }
    if (req.method === "POST" && url.pathname === "/api/plan") {
      const input = JSON.parse(await readBody(req));
      const from = coordinates(input.from, "from"); const to = coordinates(input.to, "to");
      const dateTime = typeof input.dateTime === "string" && Number.isFinite(Date.parse(input.dateTime)) ? input.dateTime : null;
      if (!dateTime || !/[+-]\d\d:\d\d$|Z$/i.test(dateTime)) throw new Error("dateTime must be an ISO 8601 timestamp with an offset");
      const preference = input.preference ?? "fastest";
      if (!["fastest", "transfers", "walking"].includes(preference)) throw new Error("preference must be fastest, transfers, or walking");
      const result = await planWithOtp({ otpUrl: config.otpUrl, timeoutMs: config.requestTimeoutMs, from, to, dateTime, arriveBy: Boolean(input.arriveBy), wheelchair: Boolean(input.wheelchair), maxWalkDistance: bounded(input.maxWalkDistance ?? 2000, "maxWalkDistance", 0, 20000), preference, maxResults: config.maxResults });
      const preferred = await applyWashroomPreference(result.itineraries, Boolean(input.preferWashrooms));
      return json(res, 200, { ...preferred, data: await graphProvenance() });
    }
    return json(res, 404, { error: "route not found" });
  } catch (error) { const upstream = error.name === "AbortError" || error.code === "UPSTREAM"; return json(res, upstream ? 503 : 400, { error: upstream ? "routing service is temporarily unavailable" : String(error.message ?? error) }); }
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, process.env.HOST ?? "0.0.0.0", () => console.log(`routing backend listening on port ${port}`));
