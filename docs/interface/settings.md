# Settings workspace

Settings has four sections: Appearance, Language, Narrator and Privacy. The selected section is kept in the browser under `gtha-settings-section-v1`. The tabs use the existing accessible tab primitive, with arrow-key navigation, labelled panels and a responsive strip. Changing sections does not recreate the planner's narration controller.

Appearance offers explicit Light and Dark choices. Language offers English, Hong Kong Cantonese and bilingual presentation, followed by separate English and Cantonese playfulness sliders. Each slider keeps its five-level preview and can reset independently to the shipped level 5. Narration retains its own language, English and Cantonese voice choices, rate, pitch, quiet mode and preview. It remains off by default. Privacy explains local preferences, routing requests, explicit sharing and independent service data.

The existing `gtha-preferences` record remains owned by the planner and retains vehicle criteria, vehicle options and division preferences. This reorganization never replaces that record with a smaller settings-only object. Narrator settings retain their separate existing browser record. If the section preference cannot be saved, the interface reports that limitation while remaining usable for the current session.

## Find an exact setting

The collapsed Find any setting control searches across all four sections. Each section also has its own collapsed Find in this section search. Each field has independent text/pattern/flag state and its own adjacent compact star opening the full regex workbench. Search includes option labels, descriptions, stable neutral identifiers and available current values. Query evaluation stays local.

Selecting a result opens its section, reveals any enclosing disclosure, scrolls to the exact control and focuses it. It does not silently enable narration or change another preference. If that target is disabled, the surrounding control group and the reason are shown. The narrator is rendered once, including when reached through search, so voice choices do not acquire duplicate identifiers or radio groups.

## Verification and boundaries

At `e0ea605`, real browser interaction verified all four tabs by pointer and keyboard, both themes, independent English level 2 and Cantonese level 3 changes, bilingual mode, and persistence after reload. Global search for Rate opened the Narrator panel, expanded its voice options and focused the disabled voice-tuning group with an explanation. The run exposed a stale explanation after narration was enabled; the followup derives that notice from current narrator state. It also removes repeated visual headings while keeping accessible legends through a real screen-reader-only utility. The corrected notice requires separate built-browser evidence. Browser emulation does not establish physical touch or spoken-audio behavior.

Suggested articles: [workspace navigation](workspaces.md), [spoken narrator](../accessibility/narrator.md), [search workbench](../search/regex-builder.md), [vehicle preferences](../planning/vehicle-preferences.md).
