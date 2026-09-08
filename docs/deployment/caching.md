# What the planner lets a browser keep

Every static response now carries a caching decision and a validator. Before this,
every single file was sent in full on every single load — including the build's
own content-hashed assets, which can never change without changing their name.

## The rule

One question decides it: **does the URL change when the bytes do?**

| | Policy | Why |
| --- | --- | --- |
| `/_next/**` | a year, `immutable` | the build hashes the name from the contents |
| `/fonts/**` | a year, `immutable` | the vendored font names are content hashes |
| `/fonts/**/material-symbols-outlined.woff2` | revalidate | its name is the family, and this repository changes the glyph subset |
| `/dim-sum/*.webp` | a day | the dish slug survives a re-vendor, so the bytes can change under a stable name |
| `/dim-sum/manifest.json` | revalidate | it decides which photos exist |
| the document | revalidate | it names the build |
| anything else | revalidate | an unrecognised path is not cached by accident |

The policy is a pure function in `lib/static-cache.ts` rather than a branch inside
the server, because importing the server starts it listening — so a rule living
there could only be checked by grepping the source. That is precisely how the
previous rule came to be wrong for two years' worth of files without anybody
noticing.

## The validator is what makes "revalidate" cheap

`no-cache` does not mean *do not store*; it means *check before using*. With
nothing to check against, the check **is** the download — so every one of those
files was being re-sent in full each time.

Every static response now carries a weak `ETag` derived from the file's size and
modification time, and a `Last-Modified`. A browser that already has the file asks
about it and gets headers back instead of the file.

Measured against the running server:

```
/                       304, 0 bytes   (the full body is 62,575)
/dim-sum/manifest.json  304, 0 bytes   (the full body is 12,522)
icon font               304, 0 bytes   (the full body is  5,404)
a stale validator       200, 12,522 bytes — still sends the file
```

## What a repeat visit stops paying for

- **~1,693 KB never requested at all**: 1,497 KB of build assets and 196 KB of the
  eighteen content-addressed fonts.
- **~79 KB that must be checked** — the document, the photo manifest and the icon
  font — now costs three header exchanges rather than 79 KB of body.

## The honest cost

A dim sum photo re-vendored with different bytes under the same name can take up
to a day to reach somebody who already has it. That is the trade for not
requesting 24 KB on a launch that shows a picture one time in ten, and it is the
reason those are a day rather than a year: a year would be a claim the filename
cannot back.

## Verification

`tests/static-caching.test.mjs`. Eleven boundaries were broken on purpose and
watched go red: each policy branch in turn, the fixed-name font list emptied, the
fallback flipped to immutable, the validator reduced to size alone, its
sub-millisecond rounding removed, and on the server side the `ETag`, the
`Last-Modified` and the conditional-request branch each deleted.

The headers were then read back off a running server rather than inferred from the
source — which mattered twice.

The first probe ran against a stale process still holding the port and reported
that none of it worked. And the first deploy took the site down: the runtime image
copies named directories, `lib/` was not one of them, and moving the policy into a
module the server imports produced a container that built cleanly and exited with
`ERR_MODULE_NOT_FOUND`. Adding an import across the image boundary without adding
the directory is invisible from a checkout, where the file is always there.

Confirmed on the deployed origin afterwards: the document answers a conditional
request with `304` and zero bytes against `200` and 62,575 cold, build assets and
content-addressed fonts come back `immutable`, and the icon font does not.
