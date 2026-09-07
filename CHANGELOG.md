# Changelog

## 0.1.0, unreleased

- Read the Metrolinx feeds correctly. Every feed path carries `Gtfs.proto`; the GO paths asked for `Gtfs`, which is not a missing endpoint but a 200 answering with the same data as JSON, so the wrong URL failed as an unreadable payload and was reported as the operator refusing the request. The proxy now checks a body begins like a feed before caching it, so that mistake can never again wear another fault's clothes. Separately, a credential present but unreadable is no longer reported as absent. GO now reports 39 service alerts and 123 live vehicles.

- Show a cancellation whose advice is written as prose rather than as a list of trains. The first real one to arrive said to board a GO bus at Stratford GO calling at Kitchener and Guelph Central; nothing plannable can be read out of that without inventing stations, so the sentence is carried whole. Returning nothing for it would have left a live disruption reading as though nothing were published.

- Give every release its dim sum code name and the photo that goes with it. The workflow had no code-name step at all, so every release so far carried a version and nothing beside it. The picker walks the public catalog, skips every dish this project has already used by reading its own release bodies, checks the photo is genuinely published, verifies its PNG signature and attaches it. A code name can never block a release: when none can be resolved the step warns and the notes carry the version alone.

- Add a journey smoke test across Toronto and the wider region, and teach it the difference between a corridor with no departure at this hour and a planner that is down. Those look the same to a rider and must not look the same here.

- Integrate ten source-backed vehicle capacity series, each carrying the operator page it came from and the basis for its figure, with a null meaning unknown rather than zero.

- Tie a departure to the vehicle finishing the trip before it on the same block. A block identifier is the publisher's own statement that one vehicle runs a named sequence of trips in order, so the bus now completing the previous trip is the bus that will arrive. It is the only published link between a vehicle and a departure this operator offers, and the interface names the block and says a service change after the observation is not reflected. The routing engine can only search a block within one route, so a block that changes route mid-day is reported as unreachable rather than guessed at.

- Pick a start and a finish for a race, ask the timetable for the journeys between them, and draw one for each team. Every route dealt is a real itinerary; two departures riding the same lines count as one route, so a draw that looks varied is. When the timetable offers fewer distinct journeys than there are teams, the shortfall is counted and shown as a real shortage rather than left looking like a deliberate pairing. The wheel spins over a result that is already decided, and reduced motion reaches the same draw with no spin, announced rather than watched.

- Plan the trains a GO cancellation names. Metrolinx writes the replacement services into the alert itself, so each one is read into an origin, a destination and a departure time, placed on the alert's own Toronto service date, and looked up in the real timetable. An option not written as a station and a time is shown exactly as published rather than guessed at, and an option the timetable cannot confirm says so instead of borrowing our authority for the operator's words.

- Read GO and UP service alerts through the routing service, which holds the operator API key so a browser never does. Without that service there is no feed, and that is reported as unavailable rather than as an absence of disruption.

- Run the routing API in the same Compose project as the frontend, reaching OpenTripPlanner over the private LAN. The frontend now reaches the API by service name, so neither can be left behind while the other runs. The dependency on the OpenTripPlanner host remains and is reported rather than claimed away.

- Commit the canonical target verifier the capture helper spawns. Its absence, not a missing timestamp, is why capture promotion had never succeeded; the first capture now passes version-1 validation and is promoted with its own record.

- Report the private routing and map origins on their own readiness route. The process health check keeps its own contract and stays available, so a frontend that is working is never restarted because an origin it depends on is not.

- Show the super express badge on the route picker and the live tracker for a whole-route identity. Those surfaces know a route but never a trip, so a branch is not guessed from a bare route number.

- Identify the rest of the Burlington fleet. Its roster writes newer buses with a leading 7 that the live feed omits; the correspondence is exact across all six series and each entry records the published form it came from.

- Identify GO Transit, Burlington Transit and Hamilton Street Railway vehicles from their published rosters. Manufacturer coverage on those three agencies was 15%, 0% and 0%; twenty-eight sourced series now cover 200 of the vehicles their live feeds report. Burlington units match only when their delivery-year suffix agrees, the GO number band shared with rail coaches is left unmatched rather than guessed, and propulsion appears only where the roster states it.

- Name the closest vehicle on the route to your boarding stop while a departure has not started, with its measured distance. A tracker normally chains a vehicle from its previous trip through shared identifiers, which this operator does not publish, so the closest vehicle is offered as exactly that and never as a confirmed assignment.

- Add a Race workspace with head-to-head races and a subway speed run: create or join a room by code, add teams, start the clock, check in at a real place from the published search with optional photo proof, and share a position only while you choose to. Photos are re-encoded in the browser, which removes camera metadata including any location tag.

- Add race rooms: a leader opens a short-lived room, teams join by a readable six-character code, and the room records team routes, position sharing and check-ins. Every limit is enforced on write and an expired room is purged with its photos. Leader and participant secrets are stored only as hashes and never appear in a readable room; position sharing starts off and stopping it clears the stored position; a photo is accepted only as a re-encoded JPEG verified by its own bytes.

- Identify the vehicle where the trip should be right now rather than anywhere along the leg. A long bus leg passes dozens of stops, and matching against all of them reported several qualifying vehicles and named none. The published stop times now place the trip precisely.

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
