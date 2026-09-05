# Agency and route picker

The tracker opens a dedicated dialog from its Agency & route control. Choose an agency, then a route, or apply all routes in that agency. The dialog reads every page of the date-aware official GTFS route catalog, with a fixed Toronto date for the complete request. It preserves route identifiers and published colors; missing colors are labelled rather than invented.

On phone-width layouts, agency selection is step 1 and the route list is step 2. Choosing an agency advances directly to its routes and focuses route search. Back returns to the agency list; changing agencies clears an incompatible route query. Desktop retains a side-by-side agency column and route list. Agency rows show their published route counts, and the selected route's badge and name remain visible on the opening control.

Only selecting an actual route or explicitly applying all routes commits the selection. Closing or cancelling keeps the prior selection. The single-route journey picker cannot commit an all-routes choice, and agency-restricted pickers recheck their restriction at the selection boundary. Every picker action is a non-submit button. Enter in editable search fields cannot implicitly submit the surrounding journey form; native keyboard activation still works on actual buttons, and IME composition is preserved.

The agency and route search fields have independent plain-text and regular-expression state. Each opens its own adjacent [advanced regex workbench](regex-builder.md). Regex evaluation runs in a bounded worker; an invalid or timed-out expression does not silently fall back to plain text.

Agency search includes familiar full names and service brands alongside the catalog's published label. For example, `Toron` finds TTC, `Viva` finds York Region Transit and `Hamil` finds HSR. These aliases filter existing published agencies; they do not add an agency or claim additional service coverage.

Enter is suppressed for search inputs and workbench radio/checkbox inputs inside the picker so it cannot implicitly submit the surrounding journey form. Space remains the native selection key, and actual buttons retain Enter activation. A live nested-form check at `145398a` exposed the radio-Enter path. The `b7e0ae4` followup verified zero planning requests after Enter in each search field, Enter on the radio and Enter on the route-selection button. Space changed the radio selection, Enter added a test case, and Enter closed only the inner workbench. No checkbox was present in that exercised surface, so a checkbox-specific runtime result is not claimed.

The catalog includes scheduled routes, which may have no vehicle in a current live feed. Selecting a route does not invent live coverage. An unavailable catalog leaves the current tracker selection unchanged and offers Retry. The dialog bounds its dimensions, scrolls its route list, supports Escape, and returns focus to its opening control.

Catalog loading commits records and their date together only after all pages validate. It rejects malformed route identities, duplicate routes, changing totals, invalid or repeated cursors, partial results, invalid calendar periods and mismatched dates. Cancellation is checked after the response even when a transport ignores abort. An open picker reloads when its requested date changes, and a stale snapshot cannot commit a selection. Timetable-period warnings distinguish out-of-period and unconfirmed records; a valid period never promises daily service or a live vehicle.

Verification uses official catalog pagination tests plus the real built dialog at desktop and phone widths. A backend catalog test alone does not verify dialog interaction or physical touch input.

![Guided route picker with its independent search workbench](../captures/route-picker-keyboard-b7e0ae4.png)

This real 1440 by 1000 viewport capture at `b7e0ae4` shows the nested workbench. Its raw bytes, source bundle, timestamps, target isolation and privacy review are recorded in the evidence inventory. The workbench continues below the viewport and scrolls internally. The separate interaction record establishes keyboard behavior; the still image does not. Physical touch and the complete language/zoom matrix remain unverified.

`tests/route-catalog.test.mjs` has nine focused tests for the production loader and selection rules, including real local HTTP pagination, later-page failure, malformed data, abort, period boundaries, the 50-page cap, aliases and agency restrictions. The loader independently accepted the public September 5 catalog: 783 routes across 11 agencies, including 70 with no published color. Real browser interactions covered the two phone steps, Back, Cancel, official route badges, all-routes selection, independent workbenches and the repaired nested-form keyboard boundary. Physical touch and the exhaustive language/zoom matrix remain separate checks.
