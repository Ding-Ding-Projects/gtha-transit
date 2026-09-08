# Typography assets

Three families ship with this interface, all served from this origin. The browser
never requests a font from a third-party host, so the interface renders the same
offline as online and no font request tells anyone else who is reading the site.

| Family | Role | Weights | Faces | Files | Bytes |
| --- | --- | --- | --- | --- | --- |
| Space Grotesk | interface text | 400, 500, 600, 700 | 12 | 3 | 47,940 |
| IBM Plex Mono | times, durations and codes | 400, 500, 600 | 15 | 15 | 152,908 |
| Material Symbols Outlined | icons | 300 | 1 | 1 | 5,372 |

The stylesheets are imported once, at the top of `app/globals.css`:

```css
@import url("/fonts/space-grotesk/space-grotesk.css");
@import url("/fonts/ibm-plex-mono/ibm-plex-mono.css");
@import url("/fonts/material-symbols-outlined/material-symbols-outlined.css");
```

Nothing else names a face directly. `app/material-theme.css` maps them onto
`--md-ref-typeface-brand`, `--md-ref-typeface-plain` and `--md-ref-typeface-mono`,
and every rule reads those. Both Latin families are followed in the stack by
`'Segoe UI'` and `'Microsoft JhengHei'`, because neither covers Traditional
Chinese and bilingual mode puts both scripts on one line.

## Why these three

They are the faces the owner's design specifies, read out of
`design/reference/GTHA Transit Redesign v2.dc.html`. The design links them from
Google Fonts at runtime; that is the one detail deliberately not copied, because
a remote font is a third-party request on every page load. The design's intent is
the typeface, and vendoring delivers it exactly.

Space Grotesk carries a verified `wght` axis from 300 through 700 with a 300
default, pinned in `scripts/vendor-fonts.mjs` from the shipped binary rather than
guessed. IBM Plex Mono ships as static per-weight files. The generated
stylesheets keep Google Fonts' own fixed-weight declarations and never rewrite
them into a range or claim an axis that was not delivered.

## The icon font, and how it fails

Material Symbols is a ligature font: the glyph is chosen by writing its **name**
as the element's text, so `<Icon name="swap_vert" />` renders arrows.

A name the font does not carry does not render a box or a blank. It renders the
literal English word, at icon size, in the middle of the interface, looking
exactly like copy somebody forgot to finish. Nothing throws and nothing logs.

The shipped file is subset to precisely the names listed in `ICON_NAMES` in
`scripts/vendor-fonts.mjs`, which is what keeps it at 5 KB instead of several
megabytes, and which also means the set of valid names is small and fixed. So
`tests/icon-glyphs.test.mjs` checks every name the source writes against the
manifest of the binary that actually shipped, and fails with instructions rather
than leaving anyone to discover the problem visually.

**Adding an icon is two steps, not one.** Add the name to `ICON_NAMES`, then run
the vendoring script. Adding only the usage produces a word where a glyph should
be.

The subset is static: `fontTools` reports no variable axes, so `app/shell.css`
sets `font-feature-settings: 'liga'` and deliberately sets no
`font-variation-settings`. Declaring an axis a font does not have makes the
browser synthesize it, silently and badly.

`components/icon.tsx` marks every glyph `aria-hidden`, because otherwise a screen
reader announces the literal text: a close button would read out as "close close",
and a swap control as "swap underscore vert". An icon-only control therefore
carries its own label.

## Provenance and licence

Each family is fetched from its canonical upstream with a fixed modern browser
User-Agent, because Google Fonts serves older formats to anything that does not
look like a browser. Every returned font URL must be `https://fonts.gstatic.com`.
The script permits HTTPS to the canonical hosts only, and rejects redirects,
credentials in URLs, unexpected hosts, oversized responses, wrong content types,
malformed CSS, unexpected weights, and anything that is not WOFF2.

Each family directory holds its own licence file, LF-normalized with trailing
whitespace removed and otherwise unmodified: SIL Open Font License 1.1 for
Space Grotesk and IBM Plex Mono, Apache 2.0 for Material Symbols. Each
`manifest.json` records source URLs, source and local SHA-256 values, retrieval
time, byte counts, every face declaration, the glyph list where one applies, and
the binary-inspection result.

## Refreshing the assets

```powershell
node scripts/vendor-fonts.mjs
```

It is idempotent: each distinct source URL is downloaded once, every response is
validated, the earlier retrieval timestamp is preserved when the source bytes are
unchanged, and a file is written only when its bytes differ. The WOFF2 signature
is checked before writing.

Where a local Python has `fontTools`, every downloaded file is decoded and its
axes are compared against what the family declares. A mismatch reports what the
binary actually says, so the expectation is pinned from evidence rather than
guessed. Where `fontTools` is absent the script records that the inspection was
unavailable and still keeps only the declarations Google returned.

## Verifying in the built application

Config is not evidence here. A `@font-face` family one character away from what
the markup asks for produces total fallback, with no error anywhere, so check the
running artifact:

- `document.fonts.check()` at every weight the interface uses;
- `getComputedStyle(document.body).fontFamily` resolves to Space Grotesk;
- a rendered `<Icon />` measures narrower than the same text would, which is what
  proves ligature substitution actually applied;
- the font stylesheet and every WOFF2 response come from this origin at runtime.
