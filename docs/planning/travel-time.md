# Travel date and time

The planner has separate Date and Time fields, with explicit Depart at and Arrive by choices. Both fields use Toronto local time, regardless of the device's timezone. The displayed GMT offset belongs to the selected instant. Native calendar and clock controls remain keyboard accessible; at narrow widths the fields stack.

Leave now selects departure mode and the current minute. Tomorrow at 9 advances the Toronto calendar by one day, even on daylight-saving transition dates, and retains the chosen departure or arrival mode.

Clearing either field preserves the other. A missing or impossible date/time cannot silently become a journey for now. The form reports the incomplete value, and agency coverage warnings remain absent until the selected time is valid. Invalid times cannot be shared as though they had been included.

Toronto's skipped spring hour is rejected. A manually entered time in the repeated autumn hour selects its earlier occurrence. An explicit instant received from a shared link or produced by the 30-minute controls keeps its original occurrence while the displayed fields still match. Editing either field returns to the manual-entry rule. Earlier and later move by 30 elapsed minutes, independent of the device timezone. Across the autumn transition, the local clock may appear to move backwards while the displayed offset changes; the requested instant still moves forward.

Time parsing and conversion happen locally. A planning request sends the resolved ISO instant to the existing routing service. A shared URL includes that same instant only after the user chooses Share. No new storage or external service is introduced.

## Verification

The 12 journey utility tests exercise calendar transitions, leap days, independent field clearing, invalid input, both repeated-hour occurrences, shared instants and elapsed shifting. Built-browser verification is recorded separately in the implementation handoff. Native input rendering, physical-device interaction and a complete language/scale matrix require their own evidence.

Suggested articles: [Planning](README.md), [Multiple destinations](multiple-stops.md), [Required lines](required-line.md), [Workspace navigation](../interface/workspaces.md).
