# GO super express branches

Six GO Transit services carry a super express label and an original badge beside the route on a journey leg.

| Identity | Scope | Published route |
| --- | --- | --- |
| `12B` | branch | 12 Niagara Falls / Burlington |
| `16` | whole route | 16 Hamilton / Toronto Express |
| `25C` | branch | 25 Waterloo / Mississauga |
| `47D` | branch | 47 Hamilton / Hwy 407 Terminal |
| `56A` | branch | 56 Oshawa / Oakville |
| `88C` | branch | 88 |

## Where the branch comes from

GO's published route catalog contains numeric routes only. Checked on 6 September 2026, it held 88 GO entries across two timetable versions and **no branch letters at all**. A branch such as `56A` exists on the trip, where GO writes it at the head of the headsign: `56A - DC Oshawa GO`.

`lib/go-express.ts` reads exactly that prefix. The leading token must be this leg's own route number followed by a single letter, so `56A` on route 56 matches and `56B`, `561`, `156A`, a bare `56` and a headsign with no prefix all return nothing. Nothing is inferred from the rest of the headsign text. Route 16 has no branch letter and is declared for the whole route.

## What the label claims, and what it does not

**Super express is a classification declared by this project's owner. It is not a service label published in the GO feed.** Every badge states that in its tooltip and in text a screen reader reaches, and the wording appears here so nobody has to guess where the classification came from. The badge is deliberately an original mark — two forward chevrons crossing a speed rule, drawn from this project's own geometry — and is not a reproduction of any operator's trademark.

The words *Super express* and the matched identity always appear beside the mark, so the badge is never the only carrier of the meaning. The mark inherits the theme's primary colour with a contrasting ink token in both light and dark appearance.

## Limits

A leg is labelled only when the agency is GO Transit and the branch or route identity matches exactly. A GO service whose headsign omits the branch prefix is not labelled, because the published data does not identify the branch. No other agency is ever labelled, even where a route number happens to collide.

Suggested articles: [passenger guide](README.md), [regional data](../data/README.md).
