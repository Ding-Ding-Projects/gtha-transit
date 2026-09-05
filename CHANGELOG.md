# Changelog

## 0.1.0, unreleased

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
