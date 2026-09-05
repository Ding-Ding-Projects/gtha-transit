# Washroom detour panel

The washroom detour panel is a caller-owned overlay for a person following a vehicle or journey. It receives the current position, remaining ordered destinations, a localized text function, and callbacks for close and facility-follow actions. It does not change the caller's original journey.

## Position and continuation review

When a valid current position is supplied, the panel uses it for a new route request. When none is available, it offers an explicit **Use current location** action. Browser geolocation is requested only after that action.

Each remaining destination may be marked visited or removed for this one detour request. The original journey remains unchanged. Remaining entries become ordered `via` points followed by the final `to` destination. When no destination remains, the panel sends `facilityOnly: true` and never invents an onward journey.

The client sends the actual current ISO timestamp, aborts after 35 seconds, aborts an in-flight request during replacement or unmount, and prevents repeated planning while a request is active.

## Result boundaries

The panel renders the facility leg and continuation independently. A confirmed-open facility can be followed through the supplied callback. A complete continuation remains distinct from the facility leg, and a partial result is labelled as unresolved rather than complete. Facility-only responses use `scope: "facility-only"` and `continuation: null`.

`washroomForPublishedPlace()` supplies public selected-stop metadata only after the agency-qualified matcher succeeds. The panel does not infer a washroom from a label.

## Responsive class seams

The caller-owned stylesheet must keep these semantic seams usable from 320 px upward without horizontal page overflow:

- `.washroom-detour-panel` is the bounded panel surface.
- `.washroom-detour-panel__header` wraps the heading and close control.
- `.washroom-detour-panel__position`, `__destinations`, `__result`, `__facility`, `__leg`, and `__continuation` are stackable sections.
- `.washroom-detour-panel__destination` and `__destination-actions` must wrap controls onto new lines at narrow widths.
- `.washroom-detour-panel__actions` keeps the planning action reachable with a visible focus state.

No position search field is present. If a future destination search field is added, it must receive its own adjacent `SearchWorkbench` and distinct storage ID.
