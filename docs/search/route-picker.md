# Agency and route picker

The tracker opens a dedicated dialog from its Agency & route control. Choose an agency, then a route, or apply all routes in that agency. The dialog reads every page of the date-aware official GTFS route catalog, with a fixed Toronto date for the complete request. It preserves route identifiers and published colors; missing colors are labelled rather than invented.

On phone-width layouts, agency selection is step 1 and the route list is step 2. Choosing an agency advances directly to its routes and focuses route search. Back returns to the agency list; changing agencies clears an incompatible route query. Desktop retains a side-by-side agency column and route list. Agency rows show their published route counts, and the selected route's badge and name remain visible on the opening control.

Only selecting an actual route or explicitly applying all routes commits the selection. Closing or cancelling keeps the prior selection. The single-route journey picker cannot commit an all-routes choice, and agency-restricted pickers recheck their restriction at the selection boundary. Every picker action is a non-submit button. Enter in editable search fields cannot implicitly submit the surrounding journey form; native keyboard activation still works on actual buttons, and IME composition is preserved.

The agency and route search fields have independent plain-text and regular-expression state. Each opens its own adjacent [advanced regex workbench](regex-builder.md). Regex evaluation runs in a bounded worker; an invalid or timed-out expression does not silently fall back to plain text.

The catalog includes scheduled routes, which may have no vehicle in a current live feed. Selecting a route does not invent live coverage. An unavailable catalog leaves the current tracker selection unchanged and offers Retry. The dialog bounds its dimensions, scrolls its route list, supports Escape, and returns focus to its opening control.

Catalog loading commits records and their date together only after all pages validate. It rejects malformed route identities, duplicate routes, changing totals, invalid or repeated cursors, partial results, invalid calendar periods and mismatched dates. Cancellation is checked after the response even when a transport ignores abort. An open picker reloads when its requested date changes, and a stale snapshot cannot commit a selection. Timetable-period warnings distinguish out-of-period and unconfirmed records; a valid period never promises daily service or a live vehicle.

Verification uses official catalog pagination tests plus the real built dialog at desktop and phone widths. A backend catalog test alone does not verify dialog interaction or physical touch input.

`tests/route-catalog.test.mjs` exercises the production loader, including real local HTTP pagination, later-page failure, malformed data, abort, period boundaries, the 50-page cap and selection restrictions. The loader independently accepted the public September 5 catalog: 783 routes across 11 agencies, including 70 with no published color. Updated two-step browser interaction remains pending deployment verification.
