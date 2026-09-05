# Spoken narrator

## What it does

The transit planner can announce short journey and service updates through the browser speech-synthesis API. It is off by default. Turning it on is an opt-in local preference and does not affect other visitors.

The narrator offers three language choices:

- English
- Hong Kong Cantonese
- Both, with English always spoken before Cantonese

Both-language announcements are serialized. The second utterance waits until the first one ends, so the two voices never overlap.

## Voice choices

English and Hong Kong Cantonese have independent saved voice selections. Each starts at Choose automatically. Automatic selection prefers an available local voice, with Canadian English preferred for English and Cantonese or Hong Kong Chinese language tags preferred for Cantonese.

The browser can populate its voice list after the settings panel first opens. The narrator listens for the browser voice-list change event and refreshes the choices when that happens. It does not incorrectly report that no voices are installed just because the first query is empty.

If a saved voice is missing on the current device, the saved choice remains unchanged. The interface reports the missing choice and uses an automatic voice for that language when one is available. If no compatible voice is currently available, narration for that language does not start and the panel says so plainly.

Some browser-provided voices are network-backed. The panel identifies them and warns that they can be silent while offline. The planner does not represent a generic Chinese voice as a Hong Kong Cantonese voice.

When the browser exposes no speech-synthesis API, the settings remain visible and explain that this browser cannot speak. Local settings can still be retained when browser storage is available.

## Timing and queueing

Narration is deliberately infrequent:

- ordinary updates wait briefly so a newer update in the same category can replace them;
- a category has a cooldown after it starts speaking;
- a newer message in an already active or queued category replaces the stale message instead of building a backlog;
- critical messages bypass the ordinary delay and cooldown; and
- only one utterance is ever active.

Disabling narration, enabling Quiet narration, or unmounting the planner stops active narration and clears queued work. Rate and pitch are user controls. Their bounds match the documented browser speech-synthesis ranges: rate from 0.1 through 10, pitch from 0 through 2, with both defaults set to 1.

## Accessibility and sound

The controls use native checkboxes, radio groups, and range inputs so they work with a keyboard and expose their current state to assistive technology. Status messages use a polite live region and identify browser support, voice availability, retained missing choices, automatic fallback, network-backed voices, and local-storage failures.

Browsers cannot reliably determine whether a screen reader is currently speaking. The planner does not claim that it can. Quiet narration is a manual user choice that immediately silences the narrator while another voice is active. It can also be used as the planner's reduced-sound choice.

## Privacy

Narrator preferences are stored only in browser-local storage. The planner does not send narrator preferences or spoken text to the routing service. A user who chooses a network-backed browser voice should review that browser or operating-system voice service separately.

## Integration contract

The parent planner calls useNarrator once near its other top-level hooks and passes the returned controller to NarratorSettings in the existing Settings panel. The same controller provides announce with a category plus English and Cantonese text.

Journey completion, route failure, service-status refresh, and saved-trip confirmation should each use stable categories. A route failure should mark the request critical so an actual failure is not hidden by the ordinary cooldown. The caller supplies factual, separately authored English and Cantonese strings. It should not pass an already combined bilingual label as one of the spoken strings.

## Verification

Focused tests cover:

- default-off and bounded persisted settings;
- English followed by Cantonese in the serialized queue;
- coalescing a stale category update;
- cooldown behavior and a critical-message bypass;
- stop behavior for Quiet narration and disablement;
- unavailable speech synthesis; and
- automatic fallback, retained missing voice selections, network-backed disclosure, and Hong Kong Cantonese voice matching.
