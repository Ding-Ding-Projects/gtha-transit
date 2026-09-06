# Changelog

## 0.1.0, unreleased

- Show the stops still ahead with the minutes to each while following a trip, and answer whether the rider has arrived. Minutes come from the stop times the routing engine publishes for the trip, using a live estimate where one exists and the timetable otherwise; a stop with no published time is shown without one rather than interpolated.

- Say that a departure has not started yet, instead of reporting it as a vehicle that could not be verified. Every unmatched leg checked on a live corridor was simply a bus that had not left.

- Build the travel date and time field value from the formatter own parts instead of replacing one space in its rendered string, and read the Toronto offset from whatever shape the browser reports, deriving it from the zone clock when the browser does not support a long offset name. Both paths previously assumed behaviour that not every browser provides.

- Stop a station escalator notice from marking a whole subway line disrupted. A line state now follows service-affecting alerts only; facility notices stay listed and are counted separately, and the line reads as running with the notice count beside it.

- Rank a stop the timetable publishes above a bare map pin of the same name, and collapse the several map pins one station attracts within 90 metres, so a search reaches something a passenger can board instead of repeating the same name.

- Mark a journey leg that runs through a confirmed TTC closure, naming the affected stops from the publisher own list and showing any officially announced shuttle verbatim. When no shuttle has been announced the leg says so rather than implying one exists. Closure handling is presentational; the route is not yet recalculated around the closed segment.

- Identify the vehicle on a bus leg when the operator publishes no matching trip identifier. A vehicle is named only when it is on the leg route and the publisher reports it at a stop the leg calls at while the leg is running, and the interface says it was identified by position. Being at a stop is measured from published coordinates rather than stop identifiers, because the TTC realtime feed numbers its stops differently from the timetable. Several qualifying vehicles are reported as such rather than guessed. An exact trip identifier now also requires the route to match, so a number collision between unrelated trips can no longer name the wrong bus.

- Label GO Transit branches 12B, 16, 25C, 47D, 56A and 88C as super express on a journey leg, with an original badge. The branch is read from the prefix GO publishes at the head of the headsign, because its route catalog carries numeric routes only. The classification is declared by this project rather than published by GO, and every badge says so.

- Show only the alerts that apply to a journey leg. A station facility notice, such as an escalator out of service, now appears beside a leg only when the leg calls at that station, service disruptions and facility notices are labelled distinctly, and every matching alert is shown instead of the first entry of a line.

- Resolve follower next-stop names from agency-qualified publisher IDs and the exact stop index instead of displaying only a numeric identifier when no journey timeline is present.

- Tailor place suggestions with published location context, timetable route colors and explicitly nearby transit details instead of bare place/station labels.

- Add directly reviewed CPTDB Milton fleet records, preserving actual build years and the distinct electric conversion of unit 1701.

- Add 72 sourced regional fleet series for MiWay, Brampton, Durham and YRT; preserve YRT electric prefixes and distinguish external roster evidence from CPTDB search destinations. Keep missing capacity, current roster status and image permissions unconfirmed.

- Replace the tall nested vehicle-preference panel with a dedicated responsive dialog, staged changes, exclusive preference modes, searchable manufacturer/model choices and immediate unknown-assignment explanations. Give TTC garage preferences a separate visible entry.
- Correct open-ended vehicle build-year matching and retain invalid criteria without excluding journeys. Add timestamped capture records that reject unsafe URLs and incomplete resource cleanup.

- Separate travel date and time, show the selected Toronto offset, and make departure/arrival choices explicit. Preserve incomplete edits, calculate tomorrow by calendar day, and retain exact shared/stepped instants through clock changes. Leave now selects departure mode.
- Move Reverse trip into its own labelled row so it cannot cover long selected stop names. Suppress schedule-coverage verdicts when the travel time is incomplete.

- Give narration rate and pitch sliders explicit accessible names and label relationships after the rendered accessibility tree exposed unnamed controls.
- Keep narrator search recovery notices synchronized with current enablement, quiet mode and voice availability. Remove redundant settings headings while preserving accessible legends.
- Organize Settings into Appearance, Language, Narrator and Privacy with guided theme and language choices, independent tone controls and exact-setting search. Preserve existing preference storage and narrator lifetime.
- Match agency acronyms through familiar full-name searches such as Toronto for TTC, and prevent Enter on embedded regex radio controls from accidentally submitting the journey form.
- Guide phone route selection through agency and route steps, preserving official colors and independent search workbenches. Validate complete date-bound catalogs and prevent picker buttons or search Enter from submitting the surrounding journey form.
- Redesign navigation and all workspaces with a desktop rail, compact mobile navigation, expanded maps and consistent control styling. Journey composition stays on Plan; other destinations use the full content width. Collapse detailed feed metadata and omit inactive single-destination reorder controls.
- Bring the tracker map forward by integrating refresh into the search toolbar and moving fleet filters and source explanations below the map. Keep partial-feed and active-filter states visible.
- Replace repeated Build regex labels with compact star controls, retaining localized accessible names, tooltips and 44px touch targets. Use a native nonmodal dialog and persist saved snippets directly from save, import and delete actions.
- Add the regional journey-planning interface and local saved-trip controls.
- Add official TTC alert ingestion with bounded reads and conservative unavailable states.
- Add Toronto timezone handling with explicit daylight-saving gap rejection and earlier repeated-time selection.
- Add static frontend container serving and private API proxy configuration.

This entry describes work in progress, not a verified public release. Commit references will be bound to the final integration at publication.

- Clarify exact versus representative vehicle photos visibly in directions and the tracker, with separate source and licence links.

- Replace the TTC LFS Hybrid representative image with a smaller, attribution-verified photo of vehicle 3539; mark it exact only for that fleet number.

- Remove two vehicle photo sources with conflicting attribution, including an oversized image that could not load through the proxy.

- Surface airport transit hubs in place search while preserving distinct stop coordinates. Empty journey results now retain neutral graph coverage context without guessing an agency from coordinates.

- Use actual map-database revisions in tile URLs, refresh both map surfaces every minute, and revalidate legacy tile paths rather than caching mutable content as immutable.

- Clear stale map-unavailable warnings after tile recovery or navigation, while preserving genuine current tile and metadata failures.

- Paginate the vehicle list while retaining all loaded map markers, use stable fleet ordering, and discard stale selections when live results change.

- Bring selected vehicle details into view automatically on phones and keyboard navigation instead of requiring a manual scroll back up.

- Compare first-service and transfer waiting for each journey option from the chosen departure time, including per-leg boarding waits.

- Show connected transit agencies together by default, add agency colour coding and readable equipment rows, and open embedded map summaries with a More details action.
