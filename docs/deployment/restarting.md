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

## One thing left for the owner to decide

On the routing host, `compose.yaml` asks for port 8787 for the routing API, and an
unrelated workload binds the same port on every interface of that host. The API
container predated the ports line and had been running with nothing published, so
recreating it made it try to bind for the first time and it could not start.

A `compose.override.yaml` on that host keeps it reachable on the compose network,
which is how it was already being reached, rather than taking a port from a
running workload belonging to something else. Which project should own that port
is a decision for its owner — not something to settle by whichever container
restarts last.

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
it back answering at 15:45:10. No real reboot has been done since the install.

**Hand-started containers.** A container started by hand onto a project network is
not a Compose service, so it cannot be recreated from the compose file. The repair
pass reconnects one that publishes no ports with `docker network connect`; one
that publishes ports is logged as `recreate it by hand` and does not hold the boot
unit up. `backend-ttc-stats-proxy-e7889a62` on the routing host is in that second
group. It serves the TTC shadow statistics only and takes no part in routing.

**The port matters too.** `backend/compose.yaml` publishes OpenTripPlanner on
`${OTP_BIND_ADDRESS:-127.0.0.1}:8790`. The routing API runs on the other host and
reaches it there. `main` had lost that line; set `OTP_BIND_ADDRESS` in the routing
host's `.env` before deploying `main`'s compose file, or routing stays down.
`backend/compose-contract.test.mjs` fails if the line disappears again.
