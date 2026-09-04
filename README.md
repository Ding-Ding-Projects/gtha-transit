# GTHA Transit

An independent journey planner for Greater Toronto and Hamilton, with cross-agency schedules, walking connections, and official TTC subway and light rail alerts.

**Public address:** [torontotransit.org](https://torontotransit.org). Domain and tunnel routing are configured separately by the owner. Publication is not verified until the hostname responds.

## Run locally

```powershell
.\build.bat --run
```

The web frontend is a static export built using the Sites scaffold. The production HTTP service uses Node built-ins and runs in a container. The routing engine and map service run separately. There is no desktop installer.

```sh
npm ci
npm run build
npm start
```

Set `ROUTING_ORIGIN` and `MAPS_ORIGIN` to the private services. Without validated transit feeds and a built routing graph, journey search reports unavailable rather than fabricating results. See [data/API documentation](docs/data/API.md), [TTC status](docs/status/README.md), and [deployment](docs/deployment/README.md).

<details><summary>Passenger features</summary>

- Search places and transit stops or select coordinates on the map.
- Plan departure-time or arrival-time journeys across agency boundaries.
- Compare duration, transfers, walking, agencies, boarding points, intermediate stops and arrival times.
- View official TTC subway and light rail alerts, with receipt freshness separate from publisher update time.
- Save trips in browser storage, reverse a trip, search earlier/later, share endpoints explicitly and export the itinerary as JSON.
- Use English, Cantonese or bilingual presentation and light/dark appearance.
- Read actual feed coverage and calendar ranges before relying on a journey.

Accessibility attributes reflect available data, not a guarantee of elevator availability. Planned service does not automatically incorporate unplanned disruptions. Fares and specialized transit bookings are not calculated.
</details>

<details><summary>Data, privacy and independence</summary>

TTC, GO Transit, UP Express, MiWay, Brampton Transit, YRT, Durham Region Transit, Oakville Transit, Burlington Transit, Milton Transit and HSR are the explicit coverage target. Loaded data and service calendars determine actual availability.

OpenStreetMap data is © OpenStreetMap contributors and licensed under the ODbL. Transit data remains subject to each publisher's licence. This project is not affiliated with TTC, Metrolinx, Triplinx or another transit agency.

No account or analytics is required. Saved trips and settings stay in the browser. Search coordinates are processed by the regional service without request-body logging. Share links contain both endpoint locations. Keep private deployment addresses and credentials outside this repository.
</details>

<details><summary>Development and verification</summary>

Run `npm run typecheck` and `npm test` locally. The static frontend production build is `npm run build`. The container build is `docker compose build` after setting the documented deployment variables.

See [ROADMAP.md](ROADMAP.md) and [HANDOFF.md](HANDOFF.md) for the current verified state. Real interface captures and end-to-end regional routing verification are pending; source previews are not deployment evidence.

The current user-approved release scope is a browser transit planner. Unrelated universal utilities and desktop packaging are explicitly deferred. This is a functional journey-planning surface, not an advertisement for an unbuilt desktop product.
</details>
