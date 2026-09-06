# Deployment

The frontend is an ARM64-compatible Node container named `gtha-transit-web`, listening on port **8080** inside the existing tunnel network. The routing and map services use a separate private host. Private host addresses are deployment variables, never checked-in defaults.

Set `SOURCE_COMMIT`, `RELEASE_TAG`, `ROUTING_ORIGIN`, `MAPS_ORIGIN`, and `TUNNEL_NETWORK` in a protected host-local environment. Build with `docker compose build`, then start with `docker compose up -d`. The configuration requests a 256 MiB memory limit, a read-only filesystem and no additional Linux capabilities. Verify the host's cgroup support before claiming the memory cap is enforced: the current frontend host reports that kernel memory limits are unsupported. Node's configured heap bound is not an equivalent process memory cap.

## Owner-managed tunnel routing

After the origin is verified, add the public hostname `toronto-transit.org` to the existing tunnel and set its HTTP service destination to:

```text
http://gtha-transit-web:8080
```

The connector and frontend must share the configured Docker network. The domain must be active in the owner's Cloudflare account. The dashboard can create the tunnel DNS record when adding the route. Do not replace unrelated hostname records. Verify public HTTPS separately after saving.

Alternatively set `WEB_BIND_ADDRESS` to the host's private LAN address and `WEB_PORT=8188`. The tunnel's HTTP service URL can then use `http://<private-host-address>:8188` even if its connector is on a different container network. The default bind is loopback; never bind every public host interface accidentally.

## Seeing a private origin fail

`/health` answers for this process only, and the container check reads it. Making it fail when a private origin is down would restart a frontend that is working perfectly, so the dependency state lives on its own route.

`GET /api/dependencies` probes the routing and map origins with a four second deadline and reports `ready` or `degraded`, naming which origin did not answer and how long it took. It never claims feed coverage or public DNS.

This exists because of a real outage: the routing container exited and stayed down for six hours while the frontend reported itself healthy, and the failure was found by a person trying to plan a journey. Poll this route.

## Where the services live

The frontend and the routing API now run in **one Compose project on one host**, as `gtha-transit-web` and `gtha-transit-api`, on a shared network. The frontend reaches the API by service name, so nothing crosses a network boundary between them and neither can be left behind while the other runs.

The routing API reaches OpenTripPlanner over the private LAN through `OTP_URL`. OTP holds a multi-gigabyte graph and stays on its own host with the map service, so **that dependency is not removed by co-location** and is not claimed to be. What co-location removes is one container that can go missing on its own; what remains is a private LAN dependency that `/api/dependencies` now reports.

### The API image needs the real indexes

The image is built from a release checkout with `data/stops.json`, `data/routes.json`, `data/route-patterns.json` and `data/transit-washrooms.json` copied in from `api/data/`. **This repository ships those four files as small placeholders**, and an image built straight from a `git archive` passes its health check while returning an entirely empty place search. That mistake has been made; do not repeat it.

The API mounts three small files read-only from `api/runtime/`: the feed manifest, the graph provenance, and the secrets directory holding the Metrolinx key. The key is never copied into an image, printed, logged or committed.

### Publishing the OpenTripPlanner port

OTP is published on the private LAN so the co-located API can reach it. **Check the port is genuinely free on that host first.** Taking a port an unrelated service already held is what interrupted routing during this migration, and adding the port at all recreates the OTP container, which reloads the graph and makes routing unavailable for roughly a minute. Do it deliberately, then poll the API health endpoint until it answers 200 before declaring the change done.
## Recovery

Retain the prior container image tag and last validated graph/data generation. Change the release tag to the prior image and recreate only this Compose project's frontend. Keep the routing service on its prior graph until a new graph passes real itinerary checks. Do not prune global Docker data or restart unrelated services.

`/health` verifies the frontend process; it does not certify routing, feed coverage, maps or public DNS. Verify those endpoints and an actual journey independently.

Suggested articles: [passenger guide](../planning/README.md), [regional data](../data/README.md).
