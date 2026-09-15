# Scheduled settings

Settings > Schedule adds time-of-day and weekday rules that automatically switch the language mode, the theme, or a saved appearance preset. Every rule and every preview is evaluated in America/Toronto time, labelled as such wherever it is shown; the time zone is fixed, not a choice, and the evaluator uses the browser's own `Intl` time zone data so it follows Daylight Saving without a bundled table. A rule's start and end are given as a clock time; an end that is at or before the start wraps the window past midnight onto the following day.

Rules live in the browser under `gtha-scheduled-settings-v1`, bounded to 20 rules of up to 60 characters each -- the same small, synchronous, per-field-fallback shape every other global preference in this project already uses. The first enabled rule that matches the current weekday and minute wins; a rule that would leave every one of language, theme and preset untouched is refused when it is parsed back, because it would do nothing. With no rule active and no override, the schedule has no opinion: it never resets anything to a shipped default on its own, it simply leaves whatever is already showing alone.

## Blank slate

An editor with zero rules offers three ready-made starters instead of an empty list: a dark theme every evening, Cantonese on weekday mornings, and bilingual mode on weekends. Accepting one adds it as an ordinary rule that can then be edited or removed like any other.

## Manual override

An override freezes the schedule's current effective language, theme and preset until a chosen moment, after which the ordinary rules resume. The one-click control sets that moment to the next boundary the schedule would otherwise change at -- computed by probing forward minute by minute rather than by a closed-form calculation, which is what keeps a Daylight Saving transition inside the preview correct without special-casing it. Clearing the override removes it immediately.

## External settings source

The Schedule section can fetch a settings document from a web address you type in, using a bounded, versioned JSON envelope (`{"version":1,"kind":"gtha-scheduled-settings","schedule":{...}}`) capped at 64 KiB. The fetch happens only when you press Import; nothing here polls, subscribes, or refetches on a timer. The response is validated with the same parser the local editor's own storage uses, so a URL cannot carry anything the local editor would not also accept, and an oversized, malformed, wrong-version or wrong-shape response is refused with a plain-language reason rather than silently discarded. Because the request is made from the browser, the remote server has to allow the request through CORS or it will fail with a network error; there is no server-side proxy in this browser-only planner, and none is added to work around that limitation.

## Interaction with other settings

School mode keeps its own authority over the language mode: a rule that would switch language is evaluated but not applied while School mode is on, exactly like the Language tab itself is hidden rather than overridden. A scheduled theme or appearance-preset change still applies while School mode is on.

## Verification and boundaries

Focused tests cover: the real weekday and minute reported across the March and November Daylight Saving transitions; a same-day rule's inclusive start and exclusive end; an overnight rule matching across the day it started and the day it wraps into; the first matching rule winning over a later one; the manual override taking priority until it expires and the underlying rule resuming afterward; the "no opinion" default; the next-change preview finding a real boundary and reporting none when nothing will ever change; the document's 20-rule bound and its per-rule fallback for a malformed entry; the starter presets; and the external envelope's bounded, versioned, typed-refusal validation. Built interaction and capture evidence for the rendered editor are recorded separately once available; the source-level tests above do not by themselves prove the mounted surface.
