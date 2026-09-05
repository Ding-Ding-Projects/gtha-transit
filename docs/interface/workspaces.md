# Workspace navigation and responsive design

The planner presents one task at a time. Desktop navigation stays on the left. Phone layouts provide Plan a trip, Vehicles, Live TTC and More at the bottom; More opens History, Out of division, Saved trips, Our region and Settings in an accessible dialog.

The journey composer belongs to Plan. Its selected locations, pending field text and preferences remain available when moving to another destination and back. Multi-destination management appears after an intermediate stop is added, so the first journey does not show inactive reorder controls. The map and itinerary options occupy the rest of the planning workspace.

The vehicle workspace uses the available width for the tracker. Agency/route selection, vehicle search and refresh come first, followed by the visible live/partial/unconfirmed state and map. Manufacturer/model/year filters and detailed source explanations follow the map. Active filters remain disclosed through the visible result count and the filter summary. All loaded matching positions remain mapped while the vehicle list uses pagination.

The shared regex star is 44 by 44 CSS pixels. It opens the full workbench for its own field, with an accessible name and tooltip. On desktop, opening the tracker workbench expands its row. The panel scrolls internally and returns focus to its star when closed. Plain-text and regex modes keep their existing behavior, and saved snippets remain local and isolated by field.

Light and dark modes share component shapes, spacing and state roles. The running version, source revision and build date/time appear above the workspace. Dates explicitly use Toronto time and include seconds. These values come from the running build's provenance rather than launch time. Small-screen editable fields retain 16px text to avoid focus zoom. Printing uses a linear content layout without navigation chrome.

## Verification and limits

The timestamped bilingual tracker capture at `b1829a948358c9b9b532d033f174f0b8214563c7` passed the version-1 evidence validator against the exact recovered served bundle, raw PNG bytes, recorded interactions, isolation and privacy review. Its [inventory record](capture-inventory.json) lists the hashes and evidence limits. The PNG is 480 by 1266 for a 320 by 844 CSS-pixel viewport at DPR 1.5, not a browser-zoom test.

![Live vehicle tracker in bilingual mode at 320 pixels](../captures/tracker-bilingual-b1829a9.png)

At `34f6ffff4c54a50cc5501b7c7d7cd70bae74cafe`, live browser evidence verified desktop navigation, four-action mobile navigation, More opening/closing, origin retention across navigation and the full-width tracker. Ordinary pointer and complete keyboard activation both saved regex snippets, which survived reload. Desktop and 320px light/dark captures are retained in the private verification record. These are real browser captures, not design mockups, but public gallery promotion and the complete language/scale matrix remain pending.

The same public revision returned 33 complete itineraries for Union to Finch, St George to Kennedy, Union to Richmond Hill Centre and Union to Pearson Terminal 1. This is a bounded routing smoke result, not a claim that every journey or agency feed is available. Physical-device operation, GPS accuracy and spoken audio require separate evidence.

No account or added tracking service is required. Changing navigation or appearance does not change the public routing request's privacy boundary. Failed live feeds keep their explicit state and are not converted to an all-clear presentation.

Suggested articles: [journey planning](../planning/README.md), [fleet filters](../vehicles/fleet-filters.md), [regular expressions](../search/regex-builder.md), [deployment](../deployment/README.md).
