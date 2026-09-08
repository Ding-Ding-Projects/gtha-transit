# Out of division: saying what the two garages mean

A vehicle is out of division when it is working a route its home garage does not run.
The panel used to show "Home garage: Wilson" beside "Route garages: Mount Dennis" and
stop there. Both facts were right, and neither said the thing a reader came for.

## The verdict leads

Two labels a reader has to compare is a puzzle, not an answer, so the panel now opens
with the verdict, then a sentence, then the facts underneath as evidence for the
sentence rather than in place of one.

- Out of division: this bus lives at one garage and the route is run from another.
- Working from home: its garage is one of the garages that runs this route.
- Home garage unconfirmed: the published allocation does not place this bus, so it is
  neither in nor out. This is a real third answer, not a failure dressed as one.

## Route colour

A route number on its own is a number. Twenty-nine tells a rider nothing about which
line it is unless they already know, and the colour is what people actually recognise,
so it appears on every route badge and on the map markers of the out-of-division
tracker.

The colour is the operator's own, from the published feed. A route with no published
colour gets none: not a generated one and not a hash of its name. An invented colour is
a claim about branding nobody made, and two unrelated routes that collide on it look
related. Those routes render plainly and say why in their title.

## Rarity

Rarity is expressed as the share of observed days on which this vehicle was seen on this
route, with the sample shown beside it: so many of so many observed days. It needs at
least seven observed days before it says anything, and the surface states that it is not
a prediction.

This is deliberately not a probability. Nobody has published one, an observation window
is not a model, and a percentage presented as a chance of catching something would be an
invention wearing a decimal point.

## When the allocation source has ended

Assignments come from a published TTC allocation summary covering a service period. When
that period has ended with no replacement published, answers still come from the last
published summary, and every result carries the period it describes. Refusing outright
was the earlier behaviour and it was unhelpful: it left every vehicle unconfirmed for the
whole gap between board periods, which reads as finding nothing rather than as an answer
a few days old. A summary whose period has not begun is still refused.

The surface names the source, its end date, and links to the operator's publications, so
a reader can check whether a newer one exists.

## Failure modes

An unreadable registry classifies everything as unconfirmed and says so. A live feed that
does not answer leaves the list empty with its own message. Neither invents a garage.

## Verification

`tests/divisions.test.mjs` covers classification, the three source coverage states
and the rarity threshold. `tests/route-colours.test.mjs` covers the lookup and the refusal
to invent a colour. The surface is driven in the built artifact by the interaction ledger
at four tuples: the classification filters, a selected vehicle, its verdict and its route
badge, with a capture after every click.

Suggested articles: [Vehicle tracking](README.md),
[Garage preference](../planning/garage-preference.md),
[Regional fleet research](regional-research.md).
