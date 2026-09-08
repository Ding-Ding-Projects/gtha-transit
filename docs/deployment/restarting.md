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
