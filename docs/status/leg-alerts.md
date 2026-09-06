# Alerts beside a journey leg

A journey leg shows only the alerts that genuinely apply to it. Everything else stays on the full alert list under Live TTC, where nothing is hidden.

## Why the narrowing exists

The TTC website alert endpoint publishes station facility notices on the same per-line list as service disruptions. On 6 September 2026, Line 5 Eglinton carried four alerts: one westbound delay at Don Valley, and three escalator notices at Kennedy, Keelesdale and Chaplin. The interface previously rendered the first entry of that list beside any Line 5 leg, so a journey that never approached Keelesdale could still display its escalator notice, and a genuine second disruption could be dropped because only one entry was rendered.

## How an alert is selected

`selectLegAlerts` in `lib/leg-alerts.ts` applies the publisher's own fields and infers nothing beyond them.

- **Route scope.** The alert must list this leg's route, or be network-wide. Route scope comes from `routeIds` and `routeScope` exactly as the status service reports them.
- **Active window.** The alert's `activeFrom` and `activeTo` must overlap the leg's own time window. An absent boundary stays open ended, as the publisher left it.
- **Kind.** Each `routeRefs` entry carries a `routeType`. A reference naming a transit mode — `Subway`, `Bus`, `Streetcar`, or a GTFS route type number — describes service. A reference naming anything else, such as `Escalator` or `Elevator`, describes a fixed facility inside one station. An unrecognized type is treated as a facility notice rather than silently presented as a service disruption.
- **Station.** A facility notice is shown only when the leg actually calls at the station the publisher named. The station is read from the title prefix the TTC writes itself — `Kennedy: Escalator 16D2E out of service…` — and compared against the station part of the leg's boarding, alighting and intermediate stop names. Nothing is inferred from the description text.

Every match is returned. Service alerts and facility notices are labelled distinctly in the interface, and each keeps the publisher's exact wording.

## Limits

A station facility notice reaches a leg only when the TTC names the station in its own title. If a future notice omits that prefix, it is not attached to any leg; it remains visible on the full alert list rather than being guessed onto a journey. Stop names without a station component, such as an on-street bus stop, never match a facility notice.

Suggested articles: [TTC status data](README.md), [disruption route groups](route-groups.md).
