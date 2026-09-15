# The documentation and landing site

[ding-ding-projects.github.io/gtha-transit](https://ding-ding-projects.github.io/gtha-transit/)
is a static site built from this repository's own `docs/` folder and published
by GitHub Pages. It exists so someone can read about the planner, see real
screenshots and open every article, before they have ever opened the app
itself; the in-app [About destination](about.md) is a separate, second
publication of the same articles for someone who already has the planner
running.

## What it is, and is not

It is a landing page plus a documentation browser. It is never the planner
itself: there is no journey composer, no live map and no saved-trip storage
here, and the page says so. Every screenshot on it is a real, already
committed capture of the built application (`docs/interface/captures/` and
`docs/design/parity/*-app.png`), never a mockup.

## How it is built

`node scripts/site/build-site.mjs` reads every article through
`scripts/docs-bundle.mjs`'s own index (the same one `public/docs/index.json`
is built from) and renders each one through `lib/doc-markdown.ts`, the
project's Markdown reader, so an article that is safe to show in the app is
rendered by the same parser here. Rendering is pure HTML string building in
`scripts/site/render.mjs`: every span of article text is escaped before it
reaches a template, exactly as the in-app reader never produces HTML from
article source. A `README.md` becomes its folder's `index.html`; every other
article becomes a matching `.html` file under `docs/`.

The build writes to a gitignored `site-dist/` folder, never into the
repository. It copies the project's own vendored fonts
(`public/fonts/`), the generated Material Design token sheet
(`app/material-theme.css`), and a curated gallery of real captures - nothing
is fetched from a CDN at build or run time.

```sh
node scripts/site/build-social-preview.mjs   # writes public/social-preview.png, committed
node scripts/site/build-site.mjs             # writes site-dist/, gitignored
node scripts/site/build-site.mjs --check     # reports page/article counts without writing
```

`--base` and `--origin` control the deployed path and host; they default to
`/gtha-transit/` and `https://ding-ding-projects.github.io`, matching the
GitHub Pages project-site URL this repository publishes to.

## What is on it

- A landing page with the planner's own description, a real-capture gallery,
  a feature list and a link to the category browser, plus the running
  version, commit and commit date read from Git at build time.
- A documentation hub listing every article by category, with a search box:
  plain text by default, with a **Use regular expression** option that
  evaluates the query as a JavaScript pattern and reports (rather than
  crashing on) one that cannot be evaluated.
- One page per article, with its source path, a link back to the file on
  GitHub, and internal links resolved the same way the in-app reader resolves
  them (`lib/doc-markdown.ts`'s `resolveDocLink`): a link to another bundled
  article becomes a site link, a link to something not bundled goes to
  GitHub, and any scheme other than http or https is refused.
- An English, Cantonese and bilingual language mode for the site's own chrome
  (navigation, buttons, headings), persisted per visitor. Article bodies stay
  English, exactly like the in-app guides browser.
- A light and dark theme, following the same Material Design 3 token sheet
  the application itself uses.

## Social preview

`scripts/site/build-social-preview.mjs` crops a real capture
(`docs/design/parity/plan-app.png`) to 1200×630 and writes
`public/social-preview.png`, which is committed. `app/layout.tsx` serves it as
the application's own `og:image`/`twitter:image`, and the site copies the
identical bytes to `assets/social-preview.png` for its own pages. Both declare
an absolute `https://` URL, `og:image:width`/`height`, `og:image:alt` and
`twitter:card summary_large_image`.

## Verification

- `tests/site-builder.test.mjs`: every real article under `docs/` renders
  without an unescaped tag reaching the output; link rewriting for a known
  article, an unbundled file and a refused scheme; the search index and its
  script default to plain text; no CDN or remote font URL anywhere in a
  page; an absolute `og:image` with matching dimensions; a responsive
  viewport tag and a skip link; and a hand-written inventory of the required
  features that fails the build if one goes missing.
- `tests/social-preview.test.mjs`: the crop geometry for both a wide and a
  tall source, that the committed PNG is exactly 1200×630, and that
  `app/layout.tsx` declares an absolute `https://` image URL.
- `node scripts/site/build-site.mjs` locally, and reading the generated
  `site-dist/` files directly.

## What is not yet verified

The deployed site has not been captured live in a real browser - that
evidence exists only after `.github/workflows/pages.yml` has run once and
published to GitHub Pages. Until then, this article and the generator's own
tests are the available evidence.

## Suggested articles

- [About: what changed, and the guides](about.md), the in-app publication of
  the same articles.
- [Deployment and recovery](../deployment/README.md), for how the application
  itself is built and served.
