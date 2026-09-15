# Surviving a restart

The planner runs as two Docker Compose stacks: the frontend and its routing API on
one host, and OpenTripPlanner plus a routing backend on another. This is what
makes both come back on their own, and what did not before.

## What went wrong once, so it is written down

Regional routing was unavailable for twelve hours. OpenTripPlanner had been
explicitly stopped, and `restart: unless-stopped` honours that *forever* — that is
what the policy means, and it kept honouring it through a host reboot. Docker
restarts what it finds running; it will not restart what somebody stopped.

Two things then made it worse than a one-line fix:

- **The container's definition had drifted from the compose file.** It predated the
  line publishing its port, so starting it produced a container listening on
  nothing. `docker compose up -d` reused it rather than recreating it, so the
  service looked up and was unreachable. Only `--force-recreate` made it match.
- **The frontend stack could not be brought up by hand at all.** Every variable in
  its compose file uses the `${VAR:?}` form, and those values only ever existed
  inside the shell running a deploy. The host had no way to recreate its own
  services.

## What is in place now

**Each stack has a systemd unit that runs `docker compose up -d` at boot** —
`gtha-transit-compose.service` on the frontend host,
`gtha-transit-backend-compose.service` on the routing host, both enabled. One
command covers both failures above: it starts anything that is not running,
*including* something explicitly stopped, and it recreates a container whose
definition has drifted from the compose file.

Neither unit has an `ExecStop`. They exist to start things, and a stop that tore
the stack down would be a teardown path nobody asked for.

**The deploy writes the values the stack needs.** `scripts/deploy.sh` writes
`.env` beside the compose file, at `077`, carrying the exact commit, image tags
and origins that deploy used. Written per deploy rather than kept by hand, so it
can never name an image that was not actually shipped.

## Verified rather than assumed

The claim was tested by reproducing the failure: stop the container explicitly,
which is precisely what took routing down, then run what boot runs.

```
after stop:            Exited (0)
after the boot unit:   Up 12 seconds (healthy)
```

Docker itself is enabled at boot on every host. Every *running* service carries
`unless-stopped` or `always`; the only containers without a restart policy are
finished one-off build and verification containers.

## The 8787 clash, settled by retirement

The routing host's old compose file asked for port 8787 for a routing API that had
already moved to the web host, and an unrelated workload binds that port on every
interface there. A `compose.override.yaml` kept the leftover API off the port.
Since the 14 September deploy of `main`'s backend compose file that service no
longer exists on the routing host (its Metrolinx proxy role is the
`metrolinx-proxy` service, which publishes nothing), so the override was retired
as `compose.override.yaml.retired-147a3250` and nothing there asks for 8787.

## Running, but detached from its network

Starting a stack at boot is not enough on its own. On 9 and again on 14 September
2026 the routing host rebooted and OpenTripPlanner came back reporting `Up` with
**no network and no published port**: `docker inspect` showed the requested port
binding under `HostConfig` and an empty `NetworkSettings.Networks`. Nothing could
reach it, so every journey failed ("Regional routing is temporarily unavailable",
0 of 14 in `scripts/smoke-journeys.mjs`). The boot unit's `docker compose up -d`
saw a running container and left it alone, and `docker restart` does not reattach
one either. Only recreating it does.

**What is in place now.** `backend/install-compose-units.sh` installs, per stack:

- `<name>.service` at boot runs `reattach-detached.sh --wait`. It starts the
  stack, recreates any running container that has no network or is missing the
  ports it asks for, optionally probes OpenTripPlanner with a real Union Station
  query, and keeps going until the stack answers. If it gives up after ten
  minutes it exits non-zero and systemd retries it every 30 seconds.
- `<name>-reattach.timer` runs one repair pass two minutes after boot and every
  two minutes after, for a detachment that happens later (a daemon restart, an
  upgrade). The pass never starts a service somebody stopped. A failing probe
  only triggers a recreate once the container has been up for 300 seconds, so a
  graph that is still loading is not mistaken for an outage.

```
# routing host
sudo backend/install-compose-units.sh gtha-transit-backend-compose /home/docker/gtha-transit-backend/backend http://<lan-address>:8790/otp/gtfs/v1
# web host
sudo backend/install-compose-units.sh gtha-transit-compose /home/docker/gtha-transit
```

The installer copies the script to `/usr/local/lib/gtha-transit/`, so the units
do not depend on where a checkout lives. The previous unit files were kept beside
each project as `*.service.before-reattach`.

**Verified on the routing host, 14 September 2026.** OpenTripPlanner was detached
on purpose with `docker network disconnect` at 15:32:57. The timer recreated it at
about 15:34:18 (`reattach: recreating otp (running with 0 networks and 0 of 1
published ports)`) and it answered the Union Station query at 15:35:30; the smoke
test then planned 14 of 14.

The boot unit was then proven on its own, with the timer stopped so it could not
help. Detached at 15:43:12, `systemctl restart gtha-transit-backend-compose.service`
returned `Result=success` and the router answered at 15:44:10. Stopped explicitly
with `docker stop` (the 7 September failure) at 15:44:11, the same restart brought
it back answering at 15:45:10.

**A real reboot, 14 September 2026, 23:25:29 Toronto.** The morning's failure happened
again on its own: OpenTripPlanner and the statistics bridge both came up with no
network. The boot unit logged `recreating otp (running with 0 networks and 0 of 1
published ports)` and the same for `ttc-stats-proxy` at 23:26:41, then `stack attached
and answering` at 23:27:37. Nobody touched the host.

**The reboot also found a second fault.** `metrolinx-proxy` and `ttc-matcher` kept their
network, so the pass left them alone, but Docker's restart policy had started them
before the host had a nameserver from DHCP, and Docker writes a container's resolver
when it starts. Their `/etc/resolv.conf` read `# NO EXTERNAL NAMESERVERS DEFINED`,
every outside lookup failed with `EAI_AGAIN`, GO and UP sat at `waiting` and the matcher
logged `poll fetch/decode failed`. Journeys still planned, which is why only the
live-coverage check noticed. Recreating the two fixed it.

The repair pass now reads that marker from every running service. If the host has a
nameserver it recreates the container (`started without an upstream DNS server`); if
the host has none yet it waits rather than recreating into the same fault. Proven by
writing the marker into the statistics bridge's resolver file: the next pass recreated
it and the pass after was clean. A pass that repaired something exits non-zero, so
systemd shows that one run as failed; that is the record of a repair, not a new fault.

**Hand-started containers.** A container started by hand onto a project network is
not a Compose service, so it cannot be recreated from the compose file. The repair
pass reconnects one that publishes no ports with `docker network connect`; one
that publishes ports is logged as `recreate it by hand` and does not hold the boot
unit up. The routing host has none left: the statistics bridge and the shadow
matcher that used to be started by hand are the `ttc-stats-proxy` and
`ttc-matcher` services since the 14 September deploy.

**The ports matter too.** `backend/compose.yaml` publishes OpenTripPlanner on
`${OTP_BIND_ADDRESS:-127.0.0.1}:8790` and the statistics bridge on
`${TTC_STATS_BIND_ADDRESS:-127.0.0.1}:18791`. The routing API runs on the other host
and reaches both there, so the routing host's `.env` sets both addresses to its LAN
address, plus `BACKEND_IMAGE_TAG` so a boot never rebuilds the Node services from
stale source. `backend/compose-contract.test.mjs` fails if either line or the image
pin disappears.
