# The changelog format

`CHANGELOG.md` stays prose for a person reading it on GitHub, and every entry
also carries a date and a category so the in-app viewer can filter it:

```
- 2026-09-14 · deployment · Bring the routing stack back on its own after a reboot. …
```

`tests/changelog.test.mjs` refuses an entry without both. Write new entries in
this shape, or run `node scripts/changelog-backfill.mjs`, which only touches
entries that do not have it yet.

## Where the date comes from

The date is the committer date of a real commit, never the day the file was
edited. The backfill looks for that commit in this order:

1. the last commit the entry itself links to;
2. otherwise a commit whose subject starts with the entry's opening words;
3. otherwise the commit that added the entry to `CHANGELOG.md`.

An entry none of these resolves gets `unknown-date · unknown`, and the guard
fails until a person dates it from evidence. The first full backfill left two
such entries; both were dated by hand from the commits that made the change
(`203bfc6` and `a48f1be`).

## Where the category comes from

From the files that commit touched, with `CHANGELOG.md` ignored:

- a merge is read through its first-parent diff, because `git show --name-only`
  lists no files for a merge;
- each file counts toward the first rule it matches, and the category with the
  most files wins, ties going to the earlier rule;
- handoff, roadmap and ordinary documentation only count when the commit
  touched nothing else.

| Order | Category | Paths |
| --- | --- | --- |
| 1 | release | `.github/`, release and packaging scripts |
| 2 | evidence | `scripts/ui-evidence/`, capture and ledger folders |
| 3 | design | `design/`, `docs/design/`, `scripts/design/` |
| 4 | race | `race/`, `docs/race/`, race components |
| 5 | vehicles | `vehicles/`, `docs/vehicles/` |
| 6 | status | `status/`, `realtime/` and their docs |
| 7 | data | `data/`, `docs/data/`, `scripts/data/` |
| 8 | deployment | `server/`, `maps/`, compose files, deploy scripts, `backend/*.sh` |
| 9 | planning | `backend/`, `shared/`, `docs/planning/` |
| 10 | accessibility | `docs/accessibility/`, the narrator |
| 11 | docs | other `docs/`, README, AGENTS, ROADMAP, HANDOFF, PLAN |
| 12 | interface | `app/`, `components/`, `lib/`, `hooks/`, `history/`, `public/`, `tests/` |
| 13 | release | anything else |

The table is a judgement call. A category that is plainly wrong for an entry
may be corrected by hand; four were, where the only evidence was a
documentation-only commit.

## Publishing

`scripts/changelog-json.mjs` runs in `prebuild` and writes
`public/changelog.json`. With a `.git` directory it first checks that every
cited commit exists and fails the build if one does not. A container build has
no `.git`, so it records `validated: "before-archive"` and relies on the check
having run in the checkout the archive came from.
