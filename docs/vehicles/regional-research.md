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

Suggested articles: [Vehicle tracking](README.md), [Vehicle preferences](../planning/vehicle-preferences.md).

## GO Transit, Burlington Transit and Hamilton Street Railway, 6 September 2026

Manufacturer coverage measured against the live feeds before this work: TTC 100%, UP 100%, MiWay 97%, **GO 15%, Burlington 0%, HSR 0%** - 259 live vehicles with no manufacturer.

Series were read from the published CPTDB rosters for each agency and kept only where the range covers units the live feed was actually reporting. Twelve GO series, three Burlington series and thirteen HSR series were added, covering 96, 8 and 96 live units respectively.

### What was deliberately left out

- **GO 2500-2620.** The same roster uses those numbers for both MCI D4500CT buses and Bombardier BiLevel rail coaches. A fleet number alone cannot say which vehicle it is, so the whole band is unmatched rather than guessed.
- **Propulsion where the roster does not state it.** An NFI XN60 is not described as diesel by its row, and several run on natural gas, so inferring a propulsion from the model would have printed a wrong fact with a citation attached to it. Propulsion appears only where the published model or engine says it.
- **Two Burlington rows** that parsed as spans of thousands of units. A cell covering more than 400 units is a parsing artefact, not a series, and is discarded.
- **Historic series** whose numbers collide with current ones, such as an HSR 1973 Rek-Vee and a 1989 MCI Classic.

### Burlington fleet numbers

Burlington writes a two-digit delivery-year suffix on each unit - `7019-15`, `7055-12` - and the roster ranges carry it too. A series matches only when the suffix agrees as well as the number, so `7019-99` matches nothing. **The build year is taken from the roster year column, never from the suffix.**

Standing capacity, current roster membership and licensed exact-unit photographs remain open for all three agencies.
