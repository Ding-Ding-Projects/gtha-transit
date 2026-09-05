# Journey vehicle chooser search inventory

Both fields use `SearchWorkbench` and `useSearchMatches`, with plain text as their initial mode and the adjacent full star workbench for deliberate regular expressions.

| Field | Storage identity | Exact scope | Availability |
| --- | --- | --- | --- |
| Search manufacturers | `journey-vehicle-company` | Unique verified manufacturer names in the supplied fleet registry | While the vehicle dialog is open |
| Search models | `journey-vehicle-model-<manufacturer>` | Only the selected manufacturer's verified models | After selecting a manufacturer |

Each mounted field owns a separate query, pattern, flags, validation and mode. Model search remounts when its manufacturer changes, so an old hidden query cannot suppress the replacement catalog. Saved snippets use the field's distinct identity. Queries reset when the draft dialog closes; snippets remain local under the existing workbench contract. The Any option remains an explicit clearing control, independently of the filtered results. Invalid or oversized expressions keep the shared workbench's bounded worker evaluation and visible explanation.

The native year fields are criteria inputs rather than text searches. The three policy choices and the narrow Company/Model/Years controls navigate or select fixed behavior; they do not search collections.

The runtime check must open both fields, exercise each star, verify independent queries and manufacturer-reset behavior, and confirm that Enter cannot submit the background trip. A component helper test alone does not establish this inventory's rendered completeness. See the current handoff for measured evidence and outstanding tuples.

Suggested articles: [Vehicle preferences](../planning/vehicle-preferences.md), [Regex workbench](regex-builder.md), [Tracker searches](tracker-surfaces.md).
