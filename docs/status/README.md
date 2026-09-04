# TTC status data

The status backend reads the TTC's official GTFS-Realtime service-alert feed at `https://bustime.ttc.ca/gtfsrt/alerts`.

`getTtcStatus()` returns a live, stale, or unavailable result. The five current rapid-transit lines are represented independently: Line 1 Yonge-University, Line 2 Bloor-Danforth, Line 4 Sheppard, Line 5 Eglinton, and Line 6 Finch West. A line is disrupted only when an active feed alert explicitly names its route ID. If the feed cannot be fetched or decoded, all lines are unknown. Cached data is served as stale after a fetch error and never becomes good by default.

The parser accepts the GTFS-Realtime protobuf wire format directly, bounds payload size and entity count, sanitizes provider text, and applies an 8 second request deadline. It retains only bounded alert fields and never logs the upstream response.
