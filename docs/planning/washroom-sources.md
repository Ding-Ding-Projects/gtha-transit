# Official washroom registry sources

`data/transit-washrooms.json` is a source-backed registry of facilities where an official operator or municipal page explicitly confirms a washroom. It does not describe every washroom in the region, and an omitted facility is not evidence that no washroom exists there.

The registry has `schemaVersion: 2`. Each facility has a stable `agencyId`, a stable `facilityId`, a `facilityType`, official names, a source URL, source receipt ID, and an actual retrieval timestamp. The accepted transit agency identifiers are `ttc`, `go`, `up`, `yrt`, `miway`, `brampton`, `drt`, `oakville`, `burlington`, `milton`, and `hsr`. City-owned records use the municipal provider identifier, such as `toronto`.

## Availability boundaries

`hours.status` is deliberately conservative.

| Value | Meaning |
| --- | --- |
| `published` | The official source publishes a facility schedule. An arrival can only be treated as eligible when the local arrival time is inside a listed interval and no applicable official exception closes or changes that interval. |
| `unknown` | The official source confirms a washroom but does not publish washroom hours. The record can be shown as a confirmed facility but cannot support an automatic open-at-arrival claim. |

All schedules use `America/Toronto`. A `weekly` item groups days that share one interval. `endsNextDay: true` is explicit for intervals that cross midnight. `holidaySchedule` records a published holiday interval when the source provides one, but does not identify which calendar dates are holidays. A caller that cannot resolve a holiday date from an authoritative calendar must treat availability as unknown. `exceptions` contains only dated source-published closures or modified hours. Missing exceptions never imply that a holiday is open.

`sourceHoursURL` and `hoursRetrievedAt` identify the source for a published schedule. `access`, `wheelchair`, and `fee` stay `null` unless the cited source states that specific fact. Coordinates stay `null` unless an official source verifies them. A coordinate object identifies its own official source receipt and feed reference. No coordinate is estimated from an address or a map pin.

## Included facility evidence

| Operator or provider | Included records | Official evidence |
| --- | --- | --- |
| TTC | Fourteen subway and LRT stations | [TTC washroom list](https://www.ttc.ca/riding-the-ttc/Washrooms-at-TTC-subway-stations) lists the stations with washrooms. It does not publish washroom-specific hours, fee, or accessibility details. |
| GO Transit | Union Station GO and Union Station Bus Terminal | [Union Station GO facilities](https://www.gotransit.com/en/find-a-station-or-stop/un/facilities-services-fare-sales) lists a public washroom. [Union Station Bus Terminal](https://www.gotransit.com/en/find-a-station-or-stop/un/un-union-station-bus-terminal-usbt-at-cibc-square) confirms washrooms on both levels and enhanced washroom accessibility. Neither page publishes washroom hours or a fee. |
| UP Express | Union Station | [UP Express Union facilities](https://www.upexpress.com/en/up-express-stations/union-station/un-facilities) lists washrooms. It does not publish washroom-specific hours, fee, or accessibility details. |
| York Region Transit | Newmarket, Pioneer Village, Richmond Hill Centre, and SmartVMC terminals | [YRT facilities](https://www.yrt.ca/en/about-us/facilities.aspx) lists public washrooms and the published terminal hours used in the registry. It does not state a washroom fee or washroom-specific accessibility for these records. |
| MiWay | City Centre Transit Terminal | [City Centre Transit Terminal](https://www.mississauga.ca/miway-transit/locations/city-centre-transit-terminal/) lists public washrooms and terminal hours. The page lists an accessible elevator, but does not make a washroom-specific accessibility statement. |
| HSR | Frank A. Cooke Transit Terminal | [HSR Customer Service](https://www.hamilton.ca/home-neighbourhood/hsr/riding-hsr/hsr-customer-service) publishes terminal and washroom hours, including its Sunday and holiday interval. |
| City of Toronto | Toronto Reference Library and High Park Library | The [Toronto Reference Library](https://tpl.ca/locations/TRL/) and [High Park Library](https://tpl.ca/locations/hp/) pages each state a wheelchair-accessible washroom and publish regular hours plus dated closures and early closes. Their coordinates come from the official branch GeoJSON receipt described below. |

The GO and UP Union coordinates are from the corresponding official GTFS downloads described by [Metrolinx software developer information](https://www.gotransit.com/en/partner-with-us/software-developers). The records retain separate agency IDs and facility IDs because the official GO and UP feeds both use the raw stop ID `UN`, and the Union complex also contains a separate TTC station. A name-normalized match alone is therefore unsafe.

The two City library coordinates come from the active [Toronto Public Library Branch General Information, WGS84 GeoJSON](https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/f5aa9b07-da35-45e6-b31f-d6790eb9bd9b/resource/5f4950b4-c727-4e54-8d0d-972e198268d6/download/tpl-branch-general-information-4326.geojson). Its exact [TRL record](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search?id=7420a950-e62b-41da-826c-32d31c46e8f8&filters=%7B%22BranchCode%22%3A%22TRL%22%7D) with `_id` `104` has the same 789 Yonge Street address as the Toronto Reference Library page. Its exact [HP record](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search?id=7420a950-e62b-41da-826c-32d31c46e8f8&filters=%7B%22BranchCode%22%3A%22HP%22%7D) with `_id` `51` has the same 228 Roncesvalles Avenue address as the High Park page. The GeoJSON supplies the verified coordinate pairs and marks each `PublicWashroom` field as `1`. The branch pages remain the source of the schedule and dated exceptions because their live hours are newer than the dataset snapshot.

## Omitted agencies and facilities

No Brampton, DRT, Oakville, Burlington, or Milton facility record is added in this revision. The review did not produce an existing, named facility that simultaneously had an official washroom confirmation and the schedule required for time-based availability. Brampton's [accessibility procedure](https://www.brampton.ca/EN/City-Hall/Accessibility/Documents/Accessibility%20-%20Transportation%20SOP.pdf) refers generally to accessible washrooms in various transit facilities, but does not identify the current facilities or their washroom hours. DRT's [Social Equity Guidelines](https://www.durhamregiontransit.com/travelling-with-us/social-equity-guidelines/) describe washrooms in future terminal design, which is not evidence of a current customer facility.

The records are intentionally not expanded from restaurant, retail, private, generic public, or operator-only washroom references. A future entry needs one official source confirming that exact facility has a washroom, plus an official hours source before it can be considered time-eligible.

Suggested articles: [planning guide](README.md), [regional transit data](../data/README.md), [API behaviour](../data/API.md).
