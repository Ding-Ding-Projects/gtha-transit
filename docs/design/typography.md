# Typography assets

## Manrope

The interface uses locally served Manrope files. The browser never requests a font from a third-party runtime host. Import the generated stylesheet from product CSS:

```css
@import url("/fonts/manrope/manrope.css");
```

The stylesheet retains the current Google Fonts response structure: 30 `@font-face` rules, five requested weights (`400`, `500`, `600`, `700`, and `800`), and six Unicode subsets per weight. It stores one WOFF2 file for each unique source URL, so the 30 rules reference six local binaries instead of duplicating the same subset five times.

The binaries are variable fonts with a verified `wght` axis from `200` through `800`. The generated stylesheet deliberately keeps Google Fonts' exact fixed-weight declarations. It does not rewrite them as a weight range or claim support for an axis Google Fonts did not deliver.

## Provenance and licence

The source CSS is the canonical request below, fetched with a fixed modern browser User-Agent:

```text
https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap
```

Each returned font URL must use `https://fonts.gstatic.com`. The vendoring script permits only HTTPS requests to the three canonical hosts needed for the CSS, WOFF2 files, and licence. It rejects redirects, credentials in URLs, unexpected hosts, oversized responses, incorrect content types, malformed CSS, unexpected weights, and non-WOFF2 responses.

The included [`OFL.txt`](../../public/fonts/manrope/OFL.txt) is fetched from the official Google Fonts source at `ofl/manrope/OFL.txt` and carries SIL Open Font License 1.1. Its checked-in copy is LF-normalized and removes trailing whitespace only. [`manifest.json`](../../public/fonts/manrope/manifest.json) records the exact source URLs, source and local SHA-256 values, retrieval time, byte counts, all face declarations, and binary-inspection result.

## Refreshing the assets

Run the vendoring script from the repository root:

```powershell
node scripts/vendor-fonts.mjs
```

The script is idempotent. It downloads each distinct source URL once, validates every response, preserves the earlier retrieval timestamp when the source bytes are unchanged, and writes a file only when its bytes differ. It validates the WOFF2 signature before writing. When `fontTools` is present in a local Python installation, it decodes every downloaded WOFF2 file and requires one `wght` axis with a `200` minimum, `200` default, and `800` maximum. If `fontTools` is absent, the script records that the optional binary inspection was unavailable and still preserves only the fixed-weight declarations returned by Google Fonts.

After changing these assets, verify the built application at every requested weight with `document.fonts.check()`, confirm the computed `font-family` resolves to Manrope, and confirm the font stylesheet and WOFF2 responses stay local at runtime.
