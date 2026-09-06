# Contextual place suggestions

Suggestions tailor their labels to published place type. Stations and transit stops show their agency and indexed timetable routes with official colors. Addresses, libraries, hospitals, parks and intersections use their own type labels; address, district and city are shown only when supplied by the data source. Confirmed washroom presence remains separate from unknown opening hours.

A map location without exact service can show routes from geocoded transit stops within 250 metres in the same search response. These are explicitly labelled Nearby transit with straight-line distance and the nearest stop name. They are not a walking route, an exact-service claim or an exhaustive nearby-service inventory. Coordinates and selected identity are never replaced. A distant location with the same name cannot inherit station routes.

The Warden report demonstrated this boundary: two map records named Warden had no serving routes, while nearby TTC platforms carried route 2. The map station can now disclose those nearby routes; the distant map location remains distinct. Missing context stays unconfirmed instead of being fabricated.

Tests cover exact versus nearby service, distance cutoff, invalid coordinates, source preservation and duplicate routes. Live response and rendered verification are recorded separately in the handoff.
