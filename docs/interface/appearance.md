# Appearance studio

Settings > Appearance contains the local studio. It provides an opaque seed palette for both themes, continuous colour inputs and thirteen colour-format representations, density, text sizing and weight, bundled or generic font choices, display naming, and a decorative-emoji preference. The command palette shares the name, size, density and emoji setters and opens the complete editors for colour, elements and transfers.

The element editor supports normal, hover, focus, pressed, selected, disabled and error states. Registered element families and tabs can override colour, typography, spacing, shape, gradients, transforms and effects. Fill, border, shadow and glow layers have order, visibility, editing locks and opacity. Layer order is top first. Right-click opens appearance actions and Shift-right-click opens the editor directly. A live preview uses the same validated stylesheet as the page.

Global choices use `gtha-appearance-v1`. Element documents and named presets use the local IndexedDB database `gtha-appearance`, store `documents`. Named presets currently capture global palette and typography choices; the complete JSON transfer also includes element styles and layers. No appearance data is sent to the routing service. Storage rejection leaves session changes usable and is reported visibly.

Undo and redo cover the current session. Restore resets global appearance and element styles while retaining named presets and saved journeys. Once storage has loaded, Control + Shift + Alt + Backspace provides a recovery shortcut. Unsupported imports retain existing state. Documents and generated styles each have a 256 KiB limit, and a rejected oversized edit does not replace the last valid snapshot.

The planner stores its appearance choices locally. The global record is versioned as `gtha-appearance-v1`; invalid individual values fall back to their shipped value, and an unrecognised document version falls back as a whole. The record is deliberately small enough for synchronous local persistence, while larger per-element work is bounded separately.

The editor addresses only the hand-written `data-ui` registry in `lib/appearance/elements.ts`. Imported data never accepts a selector, URL, script-like CSS value, or an unknown element identifier. Each supported element has explicit state records for normal, hover, focus, pressed, selected, disabled, and error states. A separate element document has bounded fill, border, shadow, and glow layers, each with explicit visibility, lock, opacity, name, and value state. The registry is the integration boundary for the frontend: JSX must opt a surface in before it can be edited.

Appearance transfers use a strict versioned JSON envelope. They carry global values, bounded per-element overrides, and non-secret presets. Unknown top-level fields, a different version, malformed JSON, or a transfer larger than 256 KiB are refused with a typed reason. Appearance transfer deliberately has no secret or external-setting field.

The pure history reducer defaults to 100 entries; the mounted studio uses a bounded 60-entry history. Element, preset, property and colour-format searches each use the anchored regex workbench. The settings and inspector element searches have separate snippet storage.

Focused verification covers invalid nested imports, generated-style limits, layer ordering, colour contrast and preservation of School mode and local wording. Built interaction and current capture provenance are recorded separately in the handoff; source checks alone do not prove the rendered editor.

## App logo customization

The Appearance section also picks the mark shown in the navigation rail, the phone bar and the browser tab. Four bundled marks ship, including the original shipped tile, plus a bounded local upload: PNG, JPEG, WebP or SVG, up to 5 MB and 4096 by 4096 source pixels. Whatever the source type, the picker never inserts it as markup -- the browser decodes it through an `<img>` element and the result is redrawn onto a 256 by 256 canvas and re-encoded as PNG, so an SVG upload is rasterised exactly like a photograph would be, and the stored bytes are capped at 200 KiB.

A choice is staged as a preview before it is applied: selecting a bundled mark or finishing an upload shows the tile it would produce, and nothing changes the rail, the phone bar or the favicon until Apply is pressed. Reset returns to the shipped mark and removes a locally uploaded image from this browser, behind the same confirmation pattern the rest of the studio uses for a destructive change.

The choice itself -- `logoId`, one of the bundled preset ids or the literal `custom` -- is a field of the small global appearance document, `gtha-appearance-v1`, so it travels through appearance export/import and through undo/redo exactly like every other global choice. The uploaded bytes for a custom mark are kept separately, in the same IndexedDB database as the element document, because a raster image is too large to hold 60 copies of in the undo history; undoing past a custom selection reverts which mark is shown without discarding the stored bytes, which remain available if redone.

The favicon updates at runtime through a `<link rel="icon">` swap, since a browser tab cannot read the page's own CSS custom properties: a bundled preset renders as a small self-contained SVG data URL in one fixed pair of colours per theme, and a custom upload reuses its own stored PNG bytes directly.
