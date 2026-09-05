# Place search and suggestions

Related tools: [Agency and route picker](route-picker.md), [advanced regex workbench](regex-builder.md), and [scheduled routes at a stop](stop-routes.md).

The planner combines generated transit-stop suggestions with the local regional map index. A result keeps the name, stable identifier, and coordinates supplied by its source. The search path does not synthesize a road, intersection, or coordinate.

## Matching behavior

Search folds Unicode with NFKD, removes combining marks, lowercases text, treats punctuation and repeated whitespace as separators, and ignores connector words such as `and`, `at`, and `the`. This makes `Églinton / Yonge`, `Yonge & Eglinton`, and `Yonge at Eglinton` equivalent for matching while preserving the source spelling in the result.

Compact letter-number forms are separated without guessing ordinary word boundaries. `Highway7`, `ward high7`, and `highway7warden` are compared as their letter and number terms, so they can find the same source-backed intersection as spaced input. A digit is split before a following word only when that word has two or more letters. This deliberately preserves single-letter suffixes such as `12A` and `501X`, and leaves adjacent ordinary letters untouched.

Common road forms compare as whole terms. `Avenue` and `Ave`, `Road` and `Rd`, and the other supported suffix pairs share a canonical form. `Highway` and `Hwy` are equivalent. `high` and `route` gain a highway alternative only next to a number, so `ward high 7` can find a Warden and Highway 7 intersection without changing the ordinary meaning of names such as High Park. `Saint`, `St`, and `Street` compare as whole terms for place names such as Saint Clair.

Every query term must match the same candidate. Alphabetic terms may use a prefix of two or more characters, while numeric terms remain exact. This permits `yo` to return both Yonge and York candidates, and `ward high 7` to find Warden and Highway 7, without combining a separate Ward result and a separate Highway 7 result into a fictional intersection. Generic edit-distance or arbitrary substring matching is not used.

Word order does not filter out a real intersection. `Yonge Eglinton` and `Eglinton Yonge` can return the same source-backed place. Exact names, named transit hubs, exact intersection terms, contiguous phrases, complete term coverage, and then controlled prefix matches determine the ranking. Stable identifiers resolve remaining ties.

## Source merge and limits

The web proxy requests transit stops and local map places in parallel. It ranks the combined candidate set before applying its 25-result response cap, so a matching intersection is not hidden behind a full stop list. Identical source identifiers and complete same-name, same-agency, same-coordinate records are collapsed; same-name places at distinct coordinates remain separate.

The response includes `partial: true` and a `sources` object when exactly one source is available. A healthy map result remains usable when the transit-routing source is unavailable, and a healthy stop result remains usable when the local map source is unavailable. The request returns HTTP 503 only when neither source is available.

The local map service accepts 1 through 120 input characters, at most 12 searchable terms, evaluates no more than 80 FTS candidates, and returns at most 20 map records. FTS terms are generated only from normalized letters and digits, then quoted before matching, so punctuation cannot change the query expression.

## Failure modes and privacy

An empty or punctuation-only request receives HTTP 400. A missing local map index is reported as unavailable, and a malformed or unavailable source never replaces valid results from the other source. Failed map refreshes retain the previously validated local graph and index.

Regional map search is local at runtime. It uses the generated SQLite FTS index and does not call a public geocoding or map service. The map and transit indexes retain the publisher-provided source identifiers and source coordinates only.

## Verification

Run the focused checks from the project root:

```text
npm --prefix backend test
py -3 maps/test_server.py
node --test tests/web-server.test.mjs
```

The regressions cover partial road input, abbreviations, `Saint` and `St`, diacritics, punctuation, reversed word order, two-letter ambiguity, exact Union ranking, misleading near matches, source merging before the cap, deduplication, and one-source partial responses.
