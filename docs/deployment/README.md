# Deployment

The frontend is an ARM64-compatible Node container named `gtha-transit-web`, listening on port **8080** inside the existing tunnel network. The routing and map services use a separate private host. Private host addresses are deployment variables, never checked-in defaults.

Set `SOURCE_COMMIT`, `RELEASE_TAG`, `ROUTING_ORIGIN`, `MAPS_ORIGIN`, and `TUNNEL_NETWORK` in a protected host-local environment. Build with `docker compose build`, then start with `docker compose up -d`. The web process has a 256 MiB memory limit, a read-only filesystem and no additional Linux capabilities.

## Owner-managed tunnel routing

After the origin is verified, add the public hostname `toronto-transit.org` to the existing tunnel and set its HTTP service destination to:

```text
http://gtha-transit-web:8080
```

The connector and frontend must share the configured Docker network. The domain must be active in the owner's Cloudflare account. The dashboard can create the tunnel DNS record when adding the route. Do not replace unrelated hostname records. Verify public HTTPS separately after saving.

Alternatively set `WEB_BIND_ADDRESS` to the host's private LAN address and `WEB_PORT=8188`. The tunnel's HTTP service URL can then use `http://<private-host-address>:8188` even if its connector is on a different container network. The default bind is loopback; never bind every public host interface accidentally.

## Recovery

Retain the prior container image tag and last validated graph/data generation. Change the release tag to the prior image and recreate only this Compose project's frontend. Keep the routing service on its prior graph until a new graph passes real itinerary checks. Do not prune global Docker data or restart unrelated services.

`/health` verifies the frontend process; it does not certify routing, feed coverage, maps or public DNS. Verify those endpoints and an actual journey independently.

Suggested articles: [passenger guide](../planning/README.md), [regional data](../data/README.md).
