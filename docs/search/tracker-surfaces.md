# Tracker search surfaces

These explicit search fields belong to the tracker and each retains isolated query, pattern, flags and mode. Plain text is the default. Every field opens the same bounded advanced Search Workbench adjacent to its originating field.

| Surface | Storage identity | Scope |
| --- | --- | --- |
| Vehicles text search | `tracker-vehicle-search` | Loaded vehicle identities, routes, agencies and published fleet details |
| Out-of-division text search | `division-vehicle-search` | Loaded records in the chosen garage classification |
| Vehicles manufacturer choices | `tracker-fleet-filter-company` | Manufacturers in the loaded agency/route selection |
| Vehicles model choices | `tracker-fleet-filter-model` | Published models of the selected manufacturer |
| Out-of-division manufacturer choices | `division-fleet-filter-company` | Manufacturers in the loaded division selection |
| Out-of-division model choices | `division-fleet-filter-model` | Published models of the selected manufacturer |

Route picking retains separate agency and route workbenches under `tracker-route-picker` and `division-route-picker`. The planner's required-route picker uses `journey-required-route` and cannot overwrite tracker snippets. Year-bound inputs validate numeric criteria and are not text-search fields.
