# The design system

The interface is built on Material Design 3 tokens generated from this project's
own brand colours. This is the record of what exists, how it is produced, and
what was verified.

## Route taken, and why

The redesign was authored in the design tool by the owner and handed over as an
export. That export is checked in under `design/reference/`, byte for byte, and it
is the specification: the implementation is compared against it rather than against
a description of it.

An earlier note here recorded that the design tool was unavailable because
authorization needed an interactive terminal. That blocker no longer applies and
the note was wrong for as long as it stayed, which is the reason it is called out
here rather than quietly deleted.

The implementation is the project's own React and CSS. A design is data: what it
describes is built, and where it hard-codes something the project's contracts
forbid, the intent is implemented through the sanctioned path and the difference is
recorded rather than copied.

## What generates what

`scripts/design/build-material-theme.mjs` produces `app/material-theme.css`.
Run it after changing a source colour; run it with `--check` to prove the
committed file still matches. The check also runs as a test.

**Source colours are the existing identity, not new ones:**

| Role source | Value | Where it came from |
| --- | --- | --- |
| Primary | `#ffb545` | the amber the design puts on every primary action |
| Secondary | `#8a7355` | the warm brown the design uses beside it |
| Tertiary | `#006b68` | the teal the previous identity used, kept as the third role |
| Neutral | `#5c5a52` light, `#243248` dark | warm paper by day, blue ink by night |
| Neutral variant | `#5f5b4f` light, `#28364c` dark | the same pair, one step cooler |
| Error | `#ba1a1a` | Material's own error source |

The neutral sources differ per scheme on purpose. The design is warm paper in the
day and blue ink at night, and one neutral cannot be both: a single source would
have made one of the two schemes a tinted version of the other rather than its own
surface. This table is generated from nothing, so it is checked against
`scripts/design/build-material-theme.mjs` by hand when a source changes.

**Tones are solved in OKLCH, not HCT.** Material builds its tonal palettes in
HCT; this is a different perceptually uniform space with the same tone numbering
and the same role mapping, solved for the CIE L\* each tone number names. Chroma
handling at the extremes differs. Saying so matters: a palette that claimed to be
HCT and was not would mislead anyone comparing it against the spec.

## What the system contains

- **34 colour roles per theme**, light and dark.
- **15 type scale steps**, from display-large to label-small.
- **7 shape steps**, from none to full.
- **6 elevation levels**.
- **State layer opacities** for hover, focus, pressed, dragged and disabled.
- **Motion durations and easings**, with reduced motion honoured at each use.

Legacy variable names (`--bg`, `--surface`, `--text` and the rest) map onto roles,
so a rule nobody has touched still renders from the system. There is one source
of truth either way.

## What it replaced

Measured on the built interface before any of this existed:

| | Before | After |
| --- | ---: | ---: |
| Material tokens | 0 | 34 roles × 2 themes |
| Distinct corner radii | 17 | a 7-step scale |
| Distinct font sizes | 18 | a 15-step scale |
| Distinct shadows | 4 arbitrary | 6 elevation levels |
| Elements with any elevation | 4 | by role |

## Navigation

Four destinations earn a permanent place (Plan, Live, Vehicles, Saved), and
everything else sits behind one More target. A Material navigation rail at 80px
on desktop, a navigation bar on mobile below the 905px breakpoint. One list feeds
both, so they cannot drift apart. The active indicator is a shape behind the
icon, not a colour change alone.

## Target sizes

Every control is at least 44×44, as one rule in `app/shell.css` rather than a
decision each component makes. The third-party map controls are included, because
a library default is not an exemption.

**The one exemption is an inline link inside a sentence**, whose height is set by
the text around it, which is the case WCAG 2.5.8 names. Measuring without it reported 52
failures on a screen that had three, and "fixing" the other 49 would have been 49
wrong changes to correct code. Any further exemption is a named selector with a
written reason in `tests/material-theme.test.mjs`.

## Verified

Driven through the cheap headless route against the built artifact, with a single
proven page target.

| Tuple | Result |
| --- | --- |
| 9 destinations × 3 widths (320, 390, 1440) × 3 languages × 2 themes = **162 screens**, against the deployed public build | 0 undersized targets, 0 unnamed controls, 0 clipped text, 0 horizontal overflow |
| Display scales 100%, 150%, 200% at 1440 | no overflow, no new clipping |
| Contrast, 16 text pairs × 2 themes | every pair at or above 4.5:1, enforced by the generator |

## Bilingual, and what it changed

Bilingual mode produces the longest strings and is where clipping appears first.
Measuring it found two real problems and confirmed one non-problem:

- The **when and options rows truncated their value** rather than their label, so
  "Mon, Sep 7, 13:00" became "Mon, Sep 7, 1...". The value is the answer and the
  label is only context, so the label gives way first now, and below 420px the two
  stack rather than compete.
- The **line-status cards truncated their status**. In bilingual it is twice as
  long and no card width holds it, so the status wraps and the cards stretch to a
  common height - 68px in bilingual, 56px otherwise.
- The **navigation labels never clipped**, in any language or width, including
  "Vehicles · 車輛".

## Measuring it correctly was most of the work

The audit over-reported three times, and each time "fixing" what it found would
have been a change to correct code:

| Reported | Actually |
| --- | --- |
| 52 undersized targets on one screen | 3. The other 49 were inline links in sentences, which WCAG 2.5.8 exempts because their height comes from the text around them. |
| 8 clipped elements on the planner | Mostly the map library's own attribution, and a label with a deliberate ellipsis beside the value it labels. |
| 24 clipped elements across the deployed build | 0. All of them were `.sr-only` text, clipped to 1px on purpose so it is announced but not seen. |

An audit that does not know the platform's own idioms manufactures work. Every
exemption is now written down with its reason rather than carried in someone's
head.

## Driven, not just captured

`scripts/ui-evidence/interaction-ledger.mjs` walks a hand-written inventory of 37
steps across ten surfaces and keeps a receipt for every click: a bounded semantic
poll on the expected state, an assertion, a privacy check, then a capture, before
the next click.

| Tuple | Result |
| --- | --- |
| 1440 px light, 1440 px dark, 390 px light, 390 px dark | **37/37 each, 148 clicks, 0 console exceptions, 0 privacy findings** |

Every row binds to the source commit, the built artifact's hash, the viewport, the
scale, the theme, the expected and observed state, and the capture's own SHA-256.
All four tuples must name the same commit, or the guard goes red: four runs at
four commits are four unrelated facts rather than one verdict.

The complete feature audit lives in `docs/interface/feature-audit.json`: 31
features, 6 present, 6 partial, 15 absent and 4 not applicable, each with its
evidence or its reason.

## Not yet done

- The ledger runs at four tuples (1440 and 390 px, light and dark). The 150 and
  200 per cent display scales were checked for overflow and clipping but not
  driven click by click.
- The **empty state** is a map, a sentence about what the service does and three
  feature lines. Once a journey is planned that column carries the route on the
  map, an option count, save/share/export and the journey cards, which reads well.
  Whether the empty state should carry more than a value proposition is a product
  question, not a layout defect.

Suggested articles: [interface verification](../docs/interface/ui-verification.md),
[the journey smoke test](../docs/verification/journey-smoke-test.md).

## Design parity

The reference is checked in, so the parity contract applies and is not optional.

`scripts/design/reference-viewer.mjs` is a committed developer tool that serves the
checked-in reference files as exported. It never copies or redraws them: a viewer
that rebuilt its own reference would be comparing the implementation against itself.
Each screen is addressable at `/screen/<label>`, so a capture names its whole tuple
in the URL rather than depending on the order things were clicked.

`design/parity-inventory.json` is hand-written and names every screen the reference
declares, exactly once, with its viewer route, the application destination it is
compared against, the state, theme, viewport and scale, and any deviation with the
reason it was accepted. It is hand-written because deriving it from the reference
would let a screen that vanished from both disappear without a word.

`scripts/design/parity-capture.mjs` photographs both sides at that one tuple through
the isolated headless route, builds a labelled side-by-side and a machine-readable
diff, and measures the Material audit on the running page rather than asserting it.
`tests/design-parity.test.mjs` fails closed on a missing screen, an incomplete tuple,
a tuple that differs between the two sides, a capture that is absent or stale, a
missing audit, or a deviation with no reason. Each of those eight boundaries was
broken on purpose, watched going red, and restored.

**What the diff is not.** The reference is a mock: its map, live counts and vehicle
lists are placeholder slots, and its data bindings render as unresolved template
expressions outside the design tool, because the export carries the template and not
the data. The application has real ones. So a large pixel difference is expected by
construction, it is recorded for review rather than gated on, and a threshold on it
would either pass everything or block every honest change. What the comparison is
actually for is layout, chrome, spacing and type.

**The reference requests remote fonts.** The export links them from a font CDN. The
product does not: all three families are vendored locally with digests, per the
asset rules. The viewer serves the export unmodified, so opening it makes those
requests from the machine running it. That is a developer tool rather than a shipped
surface, and it is stated here rather than left to be discovered.
