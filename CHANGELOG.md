# Changelog

## 0.1.0, unreleased

Every commit in this release has an entry below, except the one that publishes
these entries: a record cannot cite the commit that creates it. That commit
touches this file and nothing else.

- Photograph the palette, and correct the handoff where it had stopped being true. Two captures at 1440 in both themes, driven against the document the production server actually serves, with the theme reached through the control a person would use rather than by assigning the attribute the application rewrites from its own state. An earlier pair was discarded because the build predated the commit, so the stamp in the corner named a different build; the script refuses to fire now unless the running build reports HEAD. ([08a124e](https://github.com/Ding-Ding-Projects/gtha-transit/commit/08a124e))

- Make the palette's narration toggle an actual switch. It was a native checkbox with a width and a height set on it, which renders as an empty rectangle: no track, no thumb, and nothing to tell on from off but a tick. Invisible while reading the code, obvious in the first capture of it running. ([9e3c826](https://github.com/Ding-Ding-Projects/gtha-transit/commit/9e3c826))

- Close the palette on Escape, which a real key press proved it did not. A modal dialog gets Escape for free and this one did not, because the palette focuses a search field on open and Chromium treats Escape there as clear-this-field and consumes the key. So the first Escape anybody pressed did nothing, on a surface whose own footer says Escape closes it, while every unit test stayed green. The driver that found it is committed rather than thrown away: fifteen checks against the served document, of which this was the one that failed. ([c1a1544](https://github.com/Ding-Ding-Projects/gtha-transit/commit/c1a1544))

- Add the colour core the appearance editor and the logo customizer will both need, and keep the Material theme generator on it rather than letting a second copy of the same matrices exist. The generated theme is byte-identical after the change, which is how you know it is the same arithmetic. Writing the tests first found two defects: the CIE Lab conversion paired a D50 white point with a D65 matrix, so neutral grey came back with a chroma of 11.7 where it must be zero, and a function returning gamma-encoded channels was named for the opposite colour space. The animated rainbow is a sentinel rather than a colour string, and parsing refuses it, because a call site appending alpha to it would otherwise produce an ignored declaration and a surface with no background. ([33f4243](https://github.com/Ding-Ding-Projects/gtha-transit/commit/33f4243))

- Refresh the TTC garage source to the September 6 to October 31 summary, and stop two halves of the planner disagreeing about what an ended one means. The document states each route's division three times, so all three lists are read and only their agreement is taken; four routes needed settling against their own entry in the body and each records the sentence it came from. 249 route assignments where there were 207, which is mostly the previous extraction having missed entries rather than routes moving, and one old value wrong in a telling way: 320 Yonge was filed under Queensway while the document says ALL BUT QSY. Geometry does not read these tables, and two attempts proved it before the content stream turned out to need none. Separately, once a period ended the tracker and the garage picker answered with a dated caveat while the journey preference went silent, so from 6 September the out-of-division preference moved nothing and its badge vanished with nothing saying why. All four surfaces agree now, a period that has not started is still refused, and the new guard watches the caveat rather than the calendar, because a check that reddens every time a board period ends is a check nobody reads. ([758c0b4](https://github.com/Ding-Ding-Projects/gtha-transit/commit/758c0b4))

- Build the command palette, and take three copies of the same list down to one on the way. Ctrl+Shift+F now reaches every destination, every setting and three actions; a settings row carries its real control, so changing a value there and changing it on the settings page are the same code, and a row with a target lands the focus on the control itself rather than on the page holding it. The palette was the reason the duplication had to go: the destinations were written out in the navigation, again in the workspace heading, and would have been a third time here, and a destination added to one and forgotten in another is a palette that cannot find it with nothing to say why. Destinations and settings each come from one registry now. Seven boundaries were broken on purpose and watched going red, and the first run of that harness reported four clean misses because it was reading the wrong line for the failure count -- it self-checks against a deliberate failure before it is believed. Two existing guards went red on the refactor and were rewritten to read the registry rather than the list that moved. ([3da15b8](https://github.com/Ding-Ding-Projects/gtha-transit/commit/3da15b8))

- Complete the changelog for the pass, including the entries about the changelog itself, because one that covers every commit except those has coverage that cannot be checked. ([40411b1](https://github.com/Ding-Ding-Projects/gtha-transit/commit/40411b1))

- Bind the interaction evidence to the artifact the site actually serves. Every row carried an artifact hash described as the built artifact's own, and it was the hash of a local build directory on whatever machine ran the harness. The run drives a deployed site, and this build is not reproducible, so the field could never have matched the deployed artifact even when the source agreed. It hashes the fetched document now, and the four tuples, the deployment and a fresh fetch all agree on one value. ([3850c72](https://github.com/Ding-Ding-Projects/gtha-transit/commit/3850c72))

- Bring this file up to date with the pass so far. Recorded here rather than left out because a changelog that covers every commit except the ones about itself is a changelog whose coverage cannot be checked. ([d3339aa](https://github.com/Ding-Ding-Projects/gtha-transit/commit/d3339aa))

- Fix the line counter, which runs in the release workflow and had turned it red. Its binary exclusion listed the extensions the repository happened to hold when it was written, so it read the first committed video as UTF-8, and every file is read through a spawned git with the default one megabyte buffer, so the first tracked file past that killed the run with ENOBUFS. The buffer is explicit now and the exclusion is decided by looking at the bytes. Four guards, each watched going red, one of which found a real extensionless binary the counter was relying on a single check to notice. ([9eaffa8](https://github.com/Ding-Ding-Projects/gtha-transit/commit/9eaffa8))

- Correct a handoff claim that had stopped being true. It said nothing application-affecting had changed since the deployed commit, which was right when written and wrong two commits later. ([fe468ed](https://github.com/Ding-Ding-Projects/gtha-transit/commit/fe468ed))

- Deploy head and re-record every piece of evidence against it. The site had been serving a commit from eight back; for most of that gap only scripts and documentation had moved, but the last two commits touched application code that had never run in production. The ledger, the design-parity evidence, the walkthrough recording and the README captures were all re-recorded, because evidence naming an older commit is not wrong so much as beside the point: it describes a build nobody is using. ([ac07ee0](https://github.com/Ding-Ding-Projects/gtha-transit/commit/ac07ee0))

- Record the pass in the handoff, and take three words of internal shorthand out of it. Two of those had been committed in an earlier pass, so the file is clean from here and the history is not, which is said plainly rather than fixed by rewriting published history. A sweep of every tracked file, release body, issue, comment and discussion found nothing else. ([8bf3126](https://github.com/Ding-Ding-Projects/gtha-transit/commit/8bf3126))

- Show the interface that actually ships. The README carried three pictures, all from before the redesign, so the only images of this project were of an interface it no longer builds. Fifteen now, from the ledger that already photographs every click. Selecting one by hand went wrong immediately: a shots directory held two runs at once and a pattern picked the older, so a light screen was published as the dark one. The recorder clears stale captures, a guard refuses a mixed directory, and the publisher selects by recorded name and verifies the bytes against the hash. ([93b2388](https://github.com/Ding-Ding-Projects/gtha-transit/commit/93b2388))

- Record the application moving. Stills prove a surface exists; only a recording proves a control responds and a surface advances, and there was none. It records the renderer through the debugging protocol on an off-screen desktop and never the machine screen, because recording a monitor captures whatever the person at it was doing. With no encoder on the machine, the browser encodes it. 294 frames, VP9 in WebM, committed rather than linked to a service that can disappear, with a manifest binding it to a commit and a guard that checks the bytes and the container. ([2b9a7c0](https://github.com/Ding-Ding-Projects/gtha-transit/commit/2b9a7c0))

- Drive the three features that were shipped, tested and never once clicked. The ledger opened the out-of-division surface and stopped there, and the garage picker and the whole-network station checklist had no steps at all, so they were covered in the way a thing is covered when nobody has checked. Sixteen new steps, three of which are assertions rather than clicks, recorded as making no input rather than pretending to a click they did not make. The four tuples also stop being a sequence of hand-typed commands. ([3fcce40](https://github.com/Ding-Ding-Projects/gtha-transit/commit/3fcce40))

- Discover that half the captures were the wrong theme. The dark tuples were the light interface, every one of them, because the theme was set by assigning an attribute the application owns and rewrites from its own state on mount. Eighty images labelled dark were the same eighty as the light run, and the check that should have caught it compared the declared theme against itself. Three more of the same shape came out of driving rather than reading: tuples inheriting each other through session storage, two theme steps that asserted something true of every page, and a station list whose first line opens itself so the step clicking it was closing it. ([6d51844](https://github.com/Ding-Ding-Projects/gtha-transit/commit/6d51844))

- Write down the five features that shipped without an article, and correct one that was confidently wrong. The realtime coverage page said York Region Transit publishes no realtime URL; it does, from a different host than its timetable. Route colours had no test at all, so the lookup moved into a module with no framework in it and the behaviour worth guarding, that a route with no published colour gets none rather than a generated one, was watched failing on a deliberately added fallback. ([0c703bb](https://github.com/Ding-Ding-Projects/gtha-transit/commit/0c703bb))

- Compare the implementation against the design, and let it fail. The reference had been checked in from the start, which turns the parity contract on, and nothing satisfied it: no viewer, no inventory, no captured comparison, no gate. There is now a developer tool that serves the checked-in files as exported, a hand-written inventory naming all eight declared screens once each with every accepted deviation and its reason, both sides photographed at one identical tuple with a labelled side by side and a machine-readable diff, and a gate that was broken eight ways on purpose and watched going red each time. ([4e52d6e](https://github.com/Ding-Ding-Projects/gtha-transit/commit/4e52d6e))

- Check in the owner's authored design reference, byte for byte. Three design surfaces and four reference captures, marked `-text` so line-ending conversion cannot leave the checked-in file differing from the export it claims to be. The `ref/*.png` are captures of the site as it was, which is the input the design was drawn from and not the target: mistaking one for the other would have meant carefully rebuilding what already existed. ([ce9c8e6](https://github.com/Ding-Ding-Projects/gtha-transit/commit/ce9c8e6))

- Re-seed the palette from that design, and discover it had barely been reaching the page. The theme is amber on warm paper by day and blue ink by night, generated rather than hand-set. The larger finding was that `globals.css` redeclared eight of the generated theme's tokens with the previous palette's literal hex, on the same selectors, and loads second: fifteen declarations, every rule reading them got the old colours, and nothing failed because it is a valid stylesheet overriding another valid stylesheet. A guard now asserts the load order and refuses a redeclaration. ([3c20419](https://github.com/Ding-Ding-Projects/gtha-transit/commit/3c20419))

- Vendor Space Grotesk, IBM Plex Mono and Material Symbols locally rather than linking them, since a remote font is a third-party request on every visit. The icon subset is 5 KB because it carries only the glyphs drawn here. A ligature icon font renders an unknown name as the literal English word at icon size, so a guard checks every name the source writes against the manifest of the binary that shipped. ([c868ae4](https://github.com/Ding-Ding-Projects/gtha-transit/commit/c868ae4))

- Rebuild the rail and the composer to the design. The rail is 84px and lists every destination; the phone bar is still four and More. Reverse became an icon beside the heading, locate moved inside the origin field, and when and priority became chips that show their value. Three defects were found only by measuring the running page: the chip time was not in the mono face, the phone bar showed all nine destinations, and the design's 26px language segments were below this project's own target minimum. ([d803c8a](https://github.com/Ding-Ding-Projects/gtha-transit/commit/d803c8a))

- Make Plan map-first. The map takes the height and edges it is given rather than sitting as a 405px box in a much larger empty column. The rail's width had been subtracted twice, by `.shell` and again by `.workspace`, leaving an 84px strip of dead space on every surface. ([8a6dc1c](https://github.com/Ding-Ding-Projects/gtha-transit/commit/8a6dc1c))

- Give the select and checkboxes a Material skin, widen the trip options panel while it is open, and draw the stops a journey actually calls at. The routing API had returned `intermediateStops` on every leg all along and the map never drew them. The line colour was a literal from the previous palette, so a journey stayed green on an amber interface in both themes. ([65e84e0](https://github.com/Ding-Ding-Projects/gtha-transit/commit/65e84e0))

- Teach the capture harness what is not a defect. It had been reporting fourteen findings that were not findings: an off-screen skip link counted as a bar, and content sitting under a fixed top bar counted as an overlap, which is what a fixed bar is for. A harness that reports normal behaviour as a defect trains a reader to stop reading it, which costs more than the check is worth. ([751c864](https://github.com/Ding-Ding-Projects/gtha-transit/commit/751c864))

- Say why garage assignments are missing rather than showing four zeroes, and check every cited source. All 33 are reachable. Getting that answer took two wrong ones first: a burst of requests to Wikimedia returns 429 and some arrive as 404, and a regex reading "https:// up to the first bracket" truncates a file page at its parenthesis. Both are written into `scripts/check-sources.mjs` so nobody repeats them. ([69185d7](https://github.com/Ding-Ding-Projects/gtha-transit/commit/69185d7))

- Record what fails, in the browser as well as the service, without recording who. A journey planner's query string is where somebody lives and where they are going, so `/api/diagnostics` keeps a route pattern, a kind, a bounded message and a duration, and nothing else. The guard was watched failing on a deliberately leaked query string. ([0591f48](https://github.com/Ding-Ding-Projects/gtha-transit/commit/0591f48))

- Choose the garages whose routes you would rather ride. No feed says which vehicle a departure will be before it arrives, so what is offered is which garage runs which route, and the copy says so. It orders and never filters: a journey riding none of them is still returned, last, as an alternate. ([962072b](https://github.com/Ding-Ding-Projects/gtha-transit/commit/962072b))

- Derive every rapid transit station from the published index rather than writing one down. The TTC publishes one stop per platform and leaves `parent_station` null on all of them, so the station is read from the platform name and checked against the operator's own counts: 38, 31, 5, 25 and 18, matching all five lines, for 110 stations and seven interchanges. ([c9410ac](https://github.com/Ding-Ding-Projects/gtha-transit/commit/c9410ac))

- Keep answering from the last published TTC allocation summary once its period ends. Refusing was defensible and unhelpful: it left every vehicle unclassified for the whole gap between board periods, which reads as finding nothing rather than as an answer a few days old. A summary that has not started still refuses, and every result carries its coverage so nothing can present a stale answer as current. ([a68c8c8](https://github.com/Ding-Ding-Projects/gtha-transit/commit/a68c8c8))

- Match a navigation destination by its label rather than its glyph. The icon font puts the glyph name into the element text, so a destination whose label began "garage" read as "garage" plus the icon name and matched nothing. ([b5ce3f6](https://github.com/Ding-Ding-Projects/gtha-transit/commit/b5ce3f6))

- Add YRT vehicles. Its realtime lives at a different host from its timetable, which is why the schedule had been loaded and current while the buses were never configured. YRT contracts its operations out and prefixes each vehicle with the operator's letter, so matching the published roster needed those letters dropped, but only the ones the roster never uses: `e1911` is an electric XE40 and `1911` is not a bus at all. The vehicle panel now leads with what the two garages mean instead of leaving a reader to compare them. ([c8880a8](https://github.com/Ding-Ding-Projects/gtha-transit/commit/c8880a8))

- Refuse a destination that never arrived. Three destination steps reported a pass while navigating nowhere, because their expectation was a selector every page in the application has. A destination must now land on the heading its surface declares. ([92153d6](https://github.com/Ding-Ding-Projects/gtha-transit/commit/92153d6))

- Re-record the interaction ledger against the deployed artifact: 160 clicks across four tuples, one capture each, no console exceptions, and the whole suite green at 472 of 472. ([c8c2717](https://github.com/Ding-Ding-Projects/gtha-transit/commit/c8c2717))

- Drive the built interface and keep a receipt for every click. A hand-written inventory of 37 steps across ten surfaces, run at four tuples - 1440 and 390 px, light and dark - for 148 clicks with a capture after each, all passing, no console exceptions and no privacy findings. Every row binds to the source commit, the artifact hash, the viewport, the scale, the theme, the expected and observed state, and the capture's own hash. All four tuples must name the same commit, because four runs at four commits are four unrelated facts rather than one verdict.

- Audit every canonical feature and record the absent ones. Thirty-one features: six present, six partial, fifteen absent and four not applicable, each with its evidence or its reason. The audit does not assert that every feature exists, because a permanently red guard tells nobody what to do; it asserts that none can be silently absent, and that a row claiming something ships points at the file that ships it.

- Stop bilingual mode truncating the answer. The when and options rows were clipping their value rather than their label, so "Mon, Sep 7, 13:00" read as "Mon, Sep 7, 1..."; the label is only context and now gives way first, and below 420px the two stack instead of competing. The line-status cards were clipping their status, which in bilingual is twice as long and fits no card width, so it wraps and the cards stretch to a common height. Across three languages and three widths there is now no clipped text in any surface this project owns.

- Make a minimum target size a rule of the design system rather than a decision each component makes for itself. Chasing it control by control is how the interface came to have icon buttons at 36px, pills at 42px and map controls at 30px: each reasonable on its own, none of them big enough. Across 45 screens - nine destinations, three widths, both themes - there are now no undersized targets, no unnamed controls and no horizontal overflow.

- Correct how that was being measured. Counting inline links as failures reported 52 on one screen where there were three; WCAG exempts a link whose height is set by the text around it, and "fixing" the other 49 would have been 49 wrong changes. Every exemption from the minimum is now a named selector with a written reason, because an exemption nobody reasoned about is a hole nobody decided on.

- Give the race destination a heading. It had none, so moving to it announced nothing.

- Widen the line-status cards so their status fits. "Running · 11 facility notices" was truncated to "Running · 1...", which turns a fact into noise. The rail scrolls, so the width costs only a little scrolling.

- Give the interface a design system. It had none: seventeen corner radii, eighteen font sizes, four shadows and no Material tokens, each value invented by whichever component needed one. There are now 34 colour roles per theme generated from the project's own teal and lime, a type scale, a shape scale, six elevation levels, state layers and motion tokens. Every text pair is contrast-checked at 4.5:1 in both themes and a failure stops the build. The legacy names map onto the roles, so a rule nobody has touched still renders from the system.

- Rebuild navigation from scratch. Nine destinations in one list meant nine things to read before choosing one; four now earn a permanent place and the rest sit behind a single More. It is a Material navigation rail on desktop at the standard 80px, which gives the content back 136px, and a bottom bar on mobile where a thumb reaches it. One list feeds both, so they cannot drift apart, and the active indicator is a shape rather than a colour alone.

- Collapse the trip composer. Eighteen stacked controls became four and two disclosures: the date, time, mode and presets sit behind a row that already says when you are leaving, and the journey, vehicle and garage panels became one options group whose summary says what is set inside it. A closed disclosure that tells you nothing is just a hidden control.

- Stop the line-status strip wrapping into ragged rows. At a 130px basis every line name longer than one word broke across two lines. Names are data and cannot be shortened, so the row scrolls instead: five cards, one height, no wrapping, and no horizontal overflow at any width.

- Build the web service as a container image in the release workflow and push it to the registry, so a host deploys by pulling rather than by rebuilding from a source tarball. The release notes carry the image digest, because a tag can be repointed later and a digest cannot. Only the web service is published: the routing API needs about 48 MB of generated stop, route and pattern indexes that this repository carries as placeholders, so a runner cannot build a working one, and an image that starts and answers nothing is worse than no image.

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
