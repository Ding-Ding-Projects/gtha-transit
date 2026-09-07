# The design system

The interface is built on Material Design 3 tokens generated from this project's
own brand colours. This is the record of what exists, how it is produced, and
what was verified.

## Route taken, and why

Material Designer is the preferred route for an interface redesign. It is not
available in this environment: `DesignSync` reports that design-system
authorization needs `/design-login`, which requires an interactive terminal.
That is the exact blocker, and the sanctioned fallback was used instead — the
project's own React and CSS, with the design files kept here.

## What generates what

`scripts/design/build-material-theme.mjs` produces `app/material-theme.css`.
Run it after changing a source colour; run it with `--check` to prove the
committed file still matches. The check also runs as a test.

**Source colours are the existing identity, not new ones:**

| Role source | Value | Where it came from |
| --- | --- | --- |
| Primary | `#006b68` | the teal every primary action already used |
| Tertiary | `#d2f574` | the lime of the brand mark |
| Secondary, neutral, neutral variant, error | derived | Material's own role structure |

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

Four destinations earn a permanent place — Plan, Live, Vehicles, Saved — and
everything else sits behind one More target. A Material navigation rail at 80px
on desktop, a navigation bar on mobile below the 905px breakpoint. One list feeds
both, so they cannot drift apart. The active indicator is a shape behind the
icon, not a colour change alone.

## Target sizes

Every control is at least 44×44, as one rule in `app/shell.css` rather than a
decision each component makes. The third-party map controls are included, because
a library default is not an exemption.

**The one exemption is an inline link inside a sentence**, whose height is set by
the text around it — WCAG 2.5.8 names that case. Measuring without it reported 52
failures on a screen that had three, and "fixing" the other 49 would have been 49
wrong changes to correct code. Any further exemption is a named selector with a
written reason in `tests/material-theme.test.mjs`.

## Verified

Driven through the cheap headless route against the built artifact, with a single
proven page target.

| Tuple | Result |
| --- | --- |
| 9 destinations × 3 widths (320, 390, 1440) × 2 themes = 45 screens | 0 undersized targets, 0 unnamed controls, 0 horizontal overflow |
| Display scales 100%, 150%, 200% at 1440 | no overflow, no new clipping |
| 3 languages × 3 widths (320, 390, 1440) | 0 clipped text in our own surfaces |
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

## Not yet done

- No per-click interaction ledger. Screens were audited and captured, not driven
  control by control.
- The results area is where the next pass should go: on desktop the right column
  is a map and then nothing until a journey is planned.

Suggested articles: [interface verification](../docs/interface/ui-verification.md),
[the journey smoke test](../docs/verification/journey-smoke-test.md).
