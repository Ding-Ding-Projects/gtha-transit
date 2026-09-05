# Journey build-year matching

Journey vehicle preferences compare only the CPTDB facts attached to an assigned vehicle. They never infer a vehicle from its route, timetable, or agency.

The supported requested years are integers from 1800 through 3000, inclusive. A start year alone means that year through 3000. An end year alone means 1800 through that year. Supplying both endpoints selects their inclusive interval; leaving both empty adds no year criterion. These finite bounds keep evaluation evidence JSON-serializable without converting infinity to null.

A published build-year range matches only when its entire range lies inside the requested interval. A wholly outside range does not match. Partial overlap and missing build-year facts remain unconfirmed. These rules also apply to open-ended requests: for example, 2020 onward includes 2020-2024, excludes 2018-2019, and leaves 2018-2021 unconfirmed.

## Invalid input and recovery

The evaluator accepts integer numbers or complete four-digit strings, with surrounding whitespace allowed. It rejects partial numeric strings, decimals, exponent notation in strings, booleans, objects, arrays, non-finite numbers, and years outside the supported interval. Null, undefined, and blank strings represent an omitted endpoint.

Reversed endpoints are invalid and are never swapped. Evaluation returns `criteria.valid: false` with field-specific `criteria.validationErrors`; non-walking legs carry unknown evidence and the preference is inactive. No journey is excluded or boosted by an invalid request, even when another criterion matches. The caller can show the validation explanation and let the person correct or clear the years without losing their journey results. This also safely handles malformed stored endpoint values without throwing.

## Preference behavior

For valid criteria, Prefer performs stable ranking of verified matches. Avoid removes verified matches and, by default, unconfirmed assignments. Include unconfirmed assignments retains those unknown results. Walking legs are ignored. All/any composition across manufacturer, model, and year remains unchanged.

All evaluation is local and does not mutate the input journeys or criteria. Evidence records the finite effective interval and validation status; no network request is needed for matching.

## Verification

Run `node --test tests/journey-preferences.test.mjs`. The focused tests cover inclusive open endpoints, finite JSON round trips, whole-range containment, outside ranges, partial overlap, unknown metadata, malformed and reversed inputs, stable ranking, and avoid recovery. They verify the pure evaluator, not live vehicle assignments or rendered controls.

## Suggested articles

Consult the planning documentation index for journey-planning behavior and the vehicle data documentation for assignment provenance and source limitations.
