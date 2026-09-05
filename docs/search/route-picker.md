# Agency and route picker

The tracker opens a dedicated dialog from its Agency & route control. Choose an agency, then a route, or apply all routes in that agency. The dialog reads every page of the date-aware official GTFS route catalog, with a fixed Toronto date for the complete request. It preserves route identifiers and published colors; missing colors are labelled rather than invented.

The agency and route search fields have independent plain-text and regular-expression state. Each opens its own adjacent [advanced regex workbench](regex-builder.md). Regex evaluation runs in a bounded worker; an invalid or timed-out expression does not silently fall back to plain text.

The catalog includes scheduled routes, which may have no vehicle in a current live feed. Selecting a route does not invent live coverage. An unavailable catalog leaves the current tracker selection unchanged and offers Retry. The dialog bounds its dimensions, scrolls its route list, supports Escape, and returns focus to its opening control.

Verification uses official catalog pagination tests plus the real built dialog at desktop and phone widths. A backend catalog test alone does not verify dialog interaction or physical touch input.
