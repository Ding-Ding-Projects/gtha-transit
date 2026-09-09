# Appearance data model

The planner stores its appearance choices locally. The global record is versioned as `gtha-appearance-v1`; invalid individual values fall back to their shipped value, and an unrecognised document version falls back as a whole. The record is deliberately small enough for synchronous local persistence, while larger per-element work is bounded separately.

The editor addresses only the hand-written `data-ui` registry in `lib/appearance/elements.ts`. Imported data never accepts a selector, URL, script-like CSS value, or an unknown element identifier. Each supported element has explicit state records for normal, hover, focus, pressed, selected, disabled, and error states. The registry is the integration boundary for the frontend: JSX must opt a surface in before it can be edited.

Appearance transfers use a strict versioned JSON envelope. They carry global values, bounded per-element overrides, and non-secret presets. Unknown top-level fields, a different version, malformed JSON, or a transfer larger than 256 KiB are refused with a typed reason. Appearance transfer deliberately has no secret or external-setting field.

The pure history reducer keeps at most 100 immutable entries by default and supports undo and redo. A UI records a committed edit at the end of a gesture, so a colour drag does not become hundreds of history entries. The frontend integration also owns searchable controls: any element picker, preset list, or style property list uses the anchored regex workbench rather than a native unsearchable long list.
