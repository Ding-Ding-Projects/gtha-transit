# About: what changed, and the guides

The About destination sits after Settings in the rail and behind More on a
phone. It has two tabs, and both read files the planner serves from its own
origin, so they work offline once the page has loaded and send nothing to
GitHub unless you follow a link there.

## What changed

The changelog viewer reads `/changelog.json`, which the build writes from
`CHANGELOG.md` (see [the changelog format](changelog.md)).

- **Search** uses the same text-or-regular-expression workbench as every other
  list, over each entry's date, category and text. An expression that cannot be
  evaluated is reported and not applied, rather than hiding every entry.
- **Categories** are toggle chips; choosing none means all of them. Only
  categories that actually have entries are offered.
- **From and To** narrow by date, inclusive. An entry with no date never matches
  an active range. A start after the end is reported instead of silently
  showing nothing.
- **Export Markdown** and **Export text** download exactly the entries on
  screen, with a first line saying which range, categories and search produced
  them, so a file that leaves the app still says what it covers.
- Each entry links to the commit it describes on GitHub, in a new tab.

## Guides

The guides browser reads `/docs/index.json` and the articles beside it, which
the build copies from `docs/` (evidence folders excluded; see
`scripts/docs-bundle.mjs`).

- The index lists every article by category, searchable with the same
  workbench. The chosen article is remembered in this browser.
- Articles are rendered by `lib/doc-markdown.ts`, which turns Markdown into
  typed blocks rendered as ordinary elements. It never produces HTML, so markup
  written inside an article, including in a code sample, is shown as text.
- A link to another article opens it in place, keeping any `#anchor`. A link to
  something the bundle does not carry opens that file on GitHub. Any scheme other
  than http or https is not followed.
- Images are shown as their alt text in brackets, because the captures they
  point at are not bundled.
- The guides are written in English. The interface around them follows the
  language setting, including the bilingual mode.

## Failure modes

| Situation | What you see |
| --- | --- |
| `/changelog.json` or `/docs/index.json` missing or unreachable | an alert naming the HTTP status, and the rest of the planner unaffected |
| One article fails to load | an alert in the reader; choosing it again retries |
| A filter combination matches nothing | a message saying so, with Clear filters beside it |

## Privacy and security

Nothing is sent anywhere while reading. The two remembered choices (the active
tab and the last article) are stored in this browser under
`gtha.about.tab.v1` and `gtha.about.article.v1`. External links open with
`rel="noopener noreferrer"`.

## Verification

- `tests/changelog.test.mjs`: parsing both entry shapes, the three filters, both
  export formats, the category rule, and a guard that every entry in
  `CHANGELOG.md` is dated and categorised.
- `tests/doc-markdown.test.mjs`: block and inline parsing, markup staying text,
  unique heading ids, link resolution including refused schemes, and that every
  article in `docs/` parses and is bundled.
- The interaction ledger drives the destination, both tabs, a category filter,
  clearing filters and opening an article, at 1440 and 390 in both themes. It
  does not press Export, because the download would land in a real Downloads
  folder; the export content is covered by the unit tests.
