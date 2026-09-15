# Saved trips: search, bulk actions and export

The saved-trips list — reached from the **Saved** destination — kept every
trip a person saved, with an individual open button and an individual remove
button, and nothing else. That was a list only in the loose sense: nothing
made it searchable, nothing let a person act on more than one row at a time,
and nothing let a person get their saved trips back out of the browser other
than opening each one and screenshotting it.

`components/saved-trips-panel.tsx` is what the list actually renders now,
kept as its own component rather than more inline JSX in `app/page.tsx`, and
it gives the saved-trips list what every list of any size in this codebase is
expected to have.

## What it adds

- **Search**, through the shared `SearchWorkbench` (plain text by default,
  the regular-expression builder beside it — see
  [the workbench](../search/regex-builder.md)), matching a trip's origin,
  destination and any via stops by name.
- **Multi-select, with select-all saying which all it means.** "Select these
  N" (what the current search shows) and "select every match (N)" read as the
  same honest pair `lib/list-selection.ts` already gives the notification
  centre and the history panel.
- **Invert and clear**, the same two supporting selection actions every other
  bulk toolbar here has.
- **A preview that separates what is selected from what an action will
  change**, using `previewBulk`, before anything happens.
- **Export**, in the same eleven formats `lib/export.ts` supports elsewhere —
  JSON, JSON Lines, CSV, TSV, YAML, TOML, XML, Markdown, HTML, SQL and JSON
  Schema — honouring the current search and selection, and saying up front
  when the chosen format cannot carry everything (a nested `via` list, for
  instance, becoming JSON text inside one CSV cell).
- **Bulk delete**, gated behind the same two-key, full-slider destructive
  confirmation (`SuperConfirm`) every other irreversible bulk action in this
  codebase uses, naming the exact count and reminding a person to export
  first if they want a copy.

The single-trip open button and the single-trip remove button are unchanged:
this is additive on top of them, for the case where a person wants to act on
more than one saved trip at once, not a replacement for the everyday case of
opening or dropping the one trip in front of them.

## Every deletion still has a local history revision

Saved trips already write into the local version history described in
[Local version history](history.md): every add or removal of a trip is a new
revision of the whole saved-trips list, restorable from the **Trip history**
button beside the Saved destination's heading. A bulk delete through this
panel is no exception — it changes the `saved` array the same way an
individual remove does, so the same `app/page.tsx` effect that already
diffs and records every change to that array records the bulk delete as one
`delete` revision, restorable the same way a single removal is. `SuperConfirm`
says this plainly in its own confirmation text, so "there is no copy anywhere
else" is read beside "a local history revision is kept even after this"
rather than in place of it.

## Verification

`npm run typecheck` covers the component's typed contract with the rest of
`app/page.tsx`. The underlying selection, preview and export logic this panel
composes — `lib/list-selection.ts` and `lib/export.ts` — already carries its
own focused coverage, exercised the same way here as in
`components/notification-centre.tsx` and `components/history-panel.tsx`; this
component adds no new pure logic of its own to test in isolation, only
wiring.

## What is not done

- **No built-artifact captures.** The panel is typed and reuses tested
  logic, but has no screenshot evidence from a real running build yet.
- **No date filter.** Saved trips carry no meaningful "when this happened"
  field of their own the way a notification or a history revision does, so
  no date range is offered here; searching by name is the narrowing tool.
