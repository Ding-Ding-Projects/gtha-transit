# TTC status data

The status backend reads TTC's official route-alert endpoint at `https://www.ttc.ca/ttcapi/routedetail/getallroutesandstopsalerts`, with the official GTFS-Realtime alert feed as a bounded fallback.

`getTtcStatus()` returns `{ state, fetchedAt, sourceUpdatedAt, sourceUrl, lines, alerts }`. `fetchedAt` records when this service received the response. `sourceUpdatedAt` records the source's explicit, timezone-bearing update time. The five current rapid-transit lines are Line 1 Yonge-University (`#f4c300`), Line 2 Bloor-Danforth (`#1d7a3a`), Line 4 Sheppard (`#6a1b9a`), Line 5 Eglinton (`#8a1538`), and Line 6 Finch West (`#00838f`).

The TTC payload contains `routeAlerts` alongside other categories such as accessibility and stop alerts. It is not treated as a subway-only field. An active alert with an explicit rapid-transit route disrupts only that line; an active alert with no route is treated as network-wide and appears on every rapid-transit line. TTC notices whose `effectDesc` is `Regular service` stay visible in the aggregate alerts but do not mark a line disrupted. A source older than ten minutes, future-dated by more than one minute, a fetch failure, or a decode failure makes all line states `unknown`. Stale cached alerts may remain visible as context, but stale data never yields a `good` or `disrupted` line state. Requests use an eight-second abort deadline, refuse redirects, and cap both response bytes and alert count.

The parser accepts the GTFS-Realtime protobuf wire format directly, bounds payload size and entity count, sanitizes provider text, and applies an 8 second request deadline. It retains only bounded alert fields and never logs the upstream response.
