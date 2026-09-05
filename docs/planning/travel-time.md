# Travel date and time

The planner has separate Date and Time fields, with explicit Depart at and Arrive by choices. Both fields use Toronto local time, regardless of the device's timezone. The displayed GMT offset belongs to the selected instant. Native calendar and clock controls remain keyboard accessible; at narrow widths the fields stack.

Leave now selects departure mode and the current minute. Tomorrow at 9 advances the Toronto calendar by one day, even on daylight-saving transition dates, and retains the chosen departure or arrival mode.

Clearing either field preserves the other. A missing or impossible date/time cannot silently become a journey for now. The form reports the incomplete value, and agency coverage warnings remain absent until the selected time is valid. Invalid times cannot be shared as though they had been included.

Toronto's skipped spring hour is rejected. A manually entered time in the repeated autumn hour selects its earlier occurrence. An explicit instant received from a shared link or produced by the 30-minute controls keeps its original occurrence while the displayed fields still match. Editing either field returns to the manual-entry rule. Earlier and later move by 30 elapsed minutes, independent of the device timezone. Across the autumn transition, the local clock may appear to move backwards while the displayed offset changes; the requested instant still moves forward.

Time parsing and conversion happen locally. A planning request sends the resolved ISO instant to the existing routing service. A shared URL includes that same instant only after the user chooses Share. No new storage or external service is introduced.

## Verification

The 12 journey utility tests exercise calendar transitions, leap days, independent field clearing, invalid input, both repeated-hour occurrences, shared instants and elapsed shifting. They also pass with a Pacific/Auckland device timezone. The full integration suite passed 178 tests.

Live browser interaction at [9391cba](https://github.com/Ding-Ding-Projects/gtha-transit/commit/9391cbad8a25e8ad3ee8c6ecc08dea9f4f553330) verified native field clearing, blocked invalid submissions, no false coverage warning, both presets and an actual 30-minute request shift. The reverse control did not overlap the full Union stop name at the tested 320/390px light/dark and 320px bilingual states. The [e3e70ab](https://github.com/Ding-Ding-Projects/gtha-transit/commit/e3e70abfbbf6aceb6f52b232dcaa89085ad4038d) followup only makes the stable hydration callback dependency explicit and records the evidence.

No screenshot is published here yet: the raw capture helper omitted its actual capture timestamp, and owned browser teardown did not finish. The image is retained privately rather than promoted with invented evidence. Physical-device interaction, 360px, browser-level DST/shared-link checks and a complete language/scale matrix remain unverified. See the [handoff](../../HANDOFF.md) for the exact evidence boundary.

Suggested articles: [Planning](README.md), [Multiple destinations](multiple-stops.md), [Required lines](required-line.md), [Workspace navigation](../interface/workspaces.md).
