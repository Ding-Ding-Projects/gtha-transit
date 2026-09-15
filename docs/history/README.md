# Disruption history

`history/store.mjs` is the durable local history for successful TTC disruption snapshots. It uses Node 24's built-in `node:sqlite`, WAL mode, full synchronous commits, and a database under the configured directory (`disruptions.sqlite`). It has no network access and no automatic retention or deletion, so the total history is indefinite while each read remains bounded.

`createHistoryStore({ directory })` returns `observe(snapshot)`, `query(options)`, and `close()`. `observe` accepts the status shape from `status/ttc.mjs`. A live snapshot from one source updates `lastSeen`, appends a version only when normalized payload content changes, and marks an alert `no_longer_reported` only when that same source supplies a complete live snapshot in which it is absent. Stale, unavailable, malformed, or source-switched snapshots never resolve an earlier occurrence. If an alert returns after being marked absent, it receives a new occurrence row, preserving episodes without inventing a resolution timestamp.

Records are namespaced by `sourceUrl:id`. Route associations are stored separately, allowing one alert to cover several lines. Queries support `from` inclusive and `to` exclusive ISO date or timestamp boundaries, `line`, plain text `q` (bounded to 200 characters), and a deterministic base64url cursor ordered by `firstSeen, occurrenceId`. `limit` is bounded to 100. Query results include the latest normalized payload and the append-only version list, so exports can page through the same API without loading the whole database.

The focused test file `tests/history-store.test.mjs` covers restart persistence, unchanged deduplication and `lastSeen`, changed versions, live disappearance, stale retention, source changes, episode reappearance, date filters, pagination, invalid cursors, and bounded limits. Run it with `node --test tests/history-store.test.mjs`.

Commit b885fc065af9d56aaa264580a77608d8dd9ff1aa contains the implementation and focused tests.

## The frontend surface

`components/disruption-history.tsx`, mounted at the **History** destination,
is the client for this store: date, line and server-side text filters that
narrow what `/api/history` returns, and an export link that streams the
server's own export of whatever those filters currently select.

It also carries a second, local search — `SearchWorkbench`, the same
regular-expression-capable field every filterable list in this codebase uses
(see [the workbench](../search/regex-builder.md)) — beside the Line dropdown,
narrowing only the page of records already loaded into the browser. It is
additive on the existing server-side `q` field rather than a replacement for
it: the server field decides what is fetched from a potentially large,
append-only history; the local field decides what is shown from what has
already arrived, and says so in its own empty state so a zero-result screen
is never mistaken for "the server found nothing".

This surface carries no bulk actions or delete: the records are the
application's own observed history of official alerts, not something a
person created and owns the way a saved trip or a version-history revision
is, and the server already offers the whole thing as one export. Removing an
observed record would misrepresent what was actually seen.
