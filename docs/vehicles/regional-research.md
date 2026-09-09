# Regional fleet research

Direct isolated-browser research subsequently succeeded for MiWay, Burlington, HSR, Oakville, Milton, YRT, Brampton, GO and UP. The owner authorized page-created iframe targets while retaining one exact top-level page. Browser-extracted table records retain revision links privately; extracting a table does not make its every row reviewed. Durham did not yield a usable table in that attempt.

Eleven Milton conventional-fleet records are now drawn from [CPTDB revision 857419](https://cptdb.ca/wiki/index.php?title=Milton_Transit&oldid=857419). Fleet numbers are not build years: 2401-2407 are recorded as 2025 and 2001 as 2021. [Milton 1701-1702](https://cptdb.ca/wiki/index.php?title=Milton_Transit_1701-1702&oldid=804140) separately confirms the 2024 electric conversion of 1701; 1702 remains diesel. Missing standing capacity and photo permission remain unconfirmed. Other agency tables need careful range/exception review before import.

Research checked September 6, 2026. Published manufacturer/model/year facts are separate from live position, active fleet membership, exact assignment and image permission. The registry now includes published series for MiWay, Brampton, Durham and YRT. Source records are linked independently from CPTDB search destinations. YRT electric prefixes remain part of fleet identity.

| Agency | Current research state | Source / remaining work |
| --- | --- | --- |
| TTC | Existing official fleet ranges | Recheck individual build years and standing capacity |
| GO | Existing locomotive ranges | Bus, coach and cab-car rosters remain incomplete |
| UP Express | Existing A/C-car ranges | Verify seating plus standing capacity and unit photographs |
| MiWay | Published series added | [Photographer roster](https://barp.ca/bus/ontario/mississauga/index.html), incomplete current fleet |
| Brampton | Published series added | [Photographer roster](https://barp.ca/bus/ontario/brampt/index.html), incomplete current fleet |
| Durham | Published series added | [Photographer roster](https://barp.ca/bus/ontario/drt/index.html), fire losses and current membership need separate evidence |
| YRT | Published series added, electric prefix supported | [Photographer roster](https://barp.ca/bus/ontario/yrt/index.html), latest deliveries and retirements unconfirmed |
| Burlington | Current series unresolved | Inspected photographer index contains mainly historical buses; do not infer current equipment from it |
| HSR | Current series unresolved | [Official asset plan](https://www.hamilton.ca/sites/default/files/2024-04/strategy-hsr-asset-management-plan-2024.pdf) is a source lead; unit-level mapping remains open |
| Oakville | Current series unresolved | Inspected photographer index lacks recent models; official procurement records need unit-number mapping |
| Milton | Current series unresolved | [Official service review](https://www.milton.ca/en/living-in-milton/resources/2019_-_2023_Milton_Transit_Services_Review_and_Master_Plan_Update.pdf) is a source lead; historical photo index alone is insufficient |

CPTDB page/API access returned challenges during this pass. Search snippets are discovery leads, not sufficient to populate unverified ranges. Barp.ca publishes first-hand photo captions and series metadata but explicitly does not claim a complete roster. Its images have not been copied or hotlinked: no reuse licence was established. Existing licensed image mappings remain unchanged. No standing-capacity number is inferred from seats or a generic manufacturer maximum.

The tests resolve each new series endpoint, reject overlapping identity intervals and namespace collisions, preserve electric prefixes and assert that unsupported capacity/photo data remains absent. They do not establish every current vehicle or every photo. Full all-agency coverage remains open.

Suggested articles: [Vehicle tracking](README.md), [Vehicle preferences](../planning/vehicle-preferences.md#electric-vehicles), [Fleet filters](fleet-filters.md).

## GO Transit, Burlington Transit and Hamilton Street Railway, 6 September 2026

Manufacturer coverage measured against the live feeds before this work: TTC 100%, UP 100%, MiWay 97%, **GO 15%, Burlington 0%, HSR 0%** - 259 live vehicles with no manufacturer.

Series were read from the published CPTDB rosters for each agency and kept only where the range covers units the live feed was actually reporting. Twelve GO series, three Burlington series and thirteen HSR series were added, covering 96, 8 and 96 live units respectively.

### What was deliberately left out

- **GO 2500-2620.** The same roster uses those numbers for both MCI D4500CT buses and Bombardier BiLevel rail coaches. A fleet number alone cannot say which vehicle it is, so the whole band is unmatched rather than guessed.
- **Propulsion where the roster does not state it.** An NFI XN60 is not described as diesel by its row, and several run on natural gas, so inferring a propulsion from the model would have printed a wrong fact with a citation attached to it. Propulsion appears only where the published model or engine says it.
- **Two Burlington rows** that parsed as spans of thousands of units. A cell covering more than 400 units is a parsing artefact, not a series, and is discarded.
- **Historic series** built before 2005 on the two bus rosters. A 1973 Rek-Vee at 1215-1216 and a 1989 MCI Classic at 2204-2208 are not on the road in 2026, and letting them cancel the current series that share those numbers left a quarter of the Hamilton fleet unidentified. GO is not filtered this way because its locomotives genuinely are that old.

### Burlington fleet numbers

Burlington writes a two-digit delivery-year suffix on each unit - `7019-15`, `7055-12` - and the roster ranges carry it too. A series matches only when the suffix agrees as well as the number, so `7019-99` matches nothing. **The build year is taken from the roster year column, never from the suffix.**

### The leading 7 on Burlington units

Burlington's newer buses appear on the roster as `72101-72108` and `7-2301 to 7-2305`, while its live feed reports the same vehicles as `2101` and `2301`. The correspondence was established by matching each published series against the reporting fleet unit for unit: it is exact across all six series, every reporting unit falls inside one of them, and nothing else on the roster occupies that number band. Each entry records the published form it came from, so the mapping can be checked rather than taken on trust.

Standing capacity, current roster membership and licensed exact-unit photographs remain open for all three agencies.

## Propulsion sourcing, 9 September 2026

`vehicles/propulsion.mjs` classifies whatever `propulsion` string a roster already publishes; it never infers one. Most regional rows carry no propulsion fact at all and classify as unknown, which is correct: this project does not guess that a diesel-era series was later re-engined. Three series are the exception, because their own New Flyer or Nova Bus model designation states the propulsion outright - `Xcelsior CHARGE` is battery electric by definition, `XDE` and `LFS HEV` are diesel-electric hybrids by definition. Those three carry `propulsionBasis: 'model-designation'` and a `propulsionSource` citing the manufacturer's own product page, separately from the row's own agency-roster `source`. `tests/regional-fleet.test.mjs` checks every row with that basis actually carries a matching source, and the reverse: a row without the basis carries no `propulsionSource` either, so the two cannot drift apart.

Every manufacturer URL below was checked with `node scripts/check-sources.mjs --json` on 9 September 2026 and answered `200`:

| Series | Agencies (exact ranges in `vehicles/regional-fleet.mjs`) | Propulsion | Manufacturer source |
| --- | --- | --- | --- |
| New Flyer Xcelsior XE40 (CHARGE) | Brampton (2152-2157); YRT, three non-contiguous ranges (1911-1914, 2101-2106, 2201-2202) | Battery electric | [Xcelsior CHARGE product page](https://www.newflyer.com/bus/xcelsior-charge-ng/) - `200` |
| New Flyer Xcelsior XDE40 / XDE60 | MiWay, seven non-contiguous ranges across both models; Brampton, eight non-contiguous ranges across both models | Diesel-electric hybrid | [Xcelsior product page](https://www.newflyer.com/bus/xcelsior/) - `200` |
| Nova Bus LFS HEV | MiWay (1901-1910); Durham (6120-6129) | Diesel-electric hybrid | [Nova Bus product page](https://novabus.com/) - `200` |

Milton 1701's 2024 battery-electric conversion is not part of this table: it is a one-off repower confirmed by [a dedicated CPTDB revision](https://cptdb.ca/wiki/index.php?title=Milton_Transit_1701-1702&oldid=804140) for that specific unit, not read from its model designation (1701 and diesel 1702 share the same `Nova Bus LFS` model), so it carries a plain `propulsion` string and the row's ordinary agency-roster source rather than `propulsionBasis`/`propulsionSource`. See [Electric vehicles](../planning/vehicle-preferences.md#electric-vehicles) for how these facts are actually used in trip evaluation.

The same run also re-checked every other citation already listed in `vehicles/fleet-registry.mjs`, `vehicles/regional-fleet.mjs`, `vehicles/index.mjs`, `vehicles/divisions.mjs` and `data/ttc-divisions.json` (39 URLs total; the two `${...}` template strings and the two Metrolinx endpoints that need a key are expected skips, not failures). Three long-standing citations came back non-200 on this run and are unrelated to propulsion: the general `https://cptdb.ca/wiki/index.php/Toronto_Transit_Commission` and `https://cptdb.ca/wiki/index.php/GO_Transit` pages timed out, and `https://cptdb.ca/wiki/index.php/Burlington_Transit` returned `500`. All three are CPTDB pages, which this project's own tooling already documents as prone to exactly this kind of transient failure; none of them are propulsion citations, and none changed in this pass.
