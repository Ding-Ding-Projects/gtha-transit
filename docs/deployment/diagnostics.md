# Recording what fails, without recording who

A journey planner's query string is where somebody lives and where they are going. That
makes ordinary request logging a privacy problem rather than an operational convenience,
so this records failures in a shape that cannot carry a rider.

## What is kept

A bounded ring of the most recent failures, in memory only, each holding:

- a route pattern rather than a path, with identifier-shaped segments replaced, so
  `/api/plan/abc123` is recorded as the pattern and never the value
- a kind, such as an upstream timeout or a bad gateway
- a bounded message with control characters stripped
- a duration

There is no query string, no body, no headers, no address, no cookie and no identifier.
Nothing that is dropped is dropped by omission: the record is built from a fixed set of
fields rather than by filtering a request object, because a filter is one new field away
from leaking.

## The browser half

Uncaught errors and unhandled rejections in the page are reported to the same endpoint,
capped at ten per session so a failing render loop cannot become a flood, and sent with
the browser's own beacon so a report does not delay a page that is already in trouble.
The cap is per session and is not restored by navigation.

## Reading it

The endpoint answers with the ring and nothing else. It is a diagnostic surface for the
person running the service, and it deliberately holds nothing worth stealing.

## Failure modes

A malformed or oversized report is rejected without being recorded. The recorder itself
cannot throw into the request path: a report that cannot be built is dropped rather than
turning a handled failure into an unhandled one.

## Verification

`tests/diagnostics.test.mjs` covers the pattern replacement, the bounded ring, the
control-character stripping, the browser cap, and rejection of oversized input. The
privacy assertion was watched failing against a deliberately leaked query string before
it was trusted, because a guard nobody has seen go red proves nothing.

Suggested articles: [Deployment](README.md), [Journey smoke test](../verification/journey-smoke-test.md).
