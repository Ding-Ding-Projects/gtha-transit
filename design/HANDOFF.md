# Transit interface handoff

The visual direction is a calm regional transport workspace: forest-green navigation, high-contrast lime emphasis, a compact journey form, clear itinerary cards and a separate live status rail. Data colours distinguish transit lines; they do not imply service health.

Material Designer was inspected locally. Its export endpoint requires an existing design project/conversation and an upstream API credential; that complete handoff was unavailable to this session. The approved Sites workflow supplies the frontend scaffold and production implementation.

Screens: plan/empty, plan/searching, plan/results/expanded, plan/no-result, plan/unavailable, map/selecting, status/live, status/stale, status/unavailable, saved/empty, saved/populated, coverage, settings.

Verification tuples: 1440x1000 and 320x800 minimum, English/Cantonese/bilingual, light/dark, 100/125/150/200 percent display scales. Keyboard and touch-emulation checks are separate from real physical-device evidence.

This document is a state inventory and design rationale, not a rendered design reference or screenshot substitute. Built interaction and image evidence remain required.

The September 5 revision prioritizes a guided agency/route dialog, company-first vehicle choices, compact narrator options, ordered destinations and a dedicated fleet-division surface. Native semantic inputs retain keyboard behavior while their visible controls use the shared theme, consistent 44px-or-larger targets, selection states and bounded panels. Material Designer's complete handoff remains unavailable in this session: the earlier inspected export flow requires an existing project and upstream credential, and no callable export tool is exposed. The existing React/Sites scaffold remains the implementation route. New typography assets and real built-state verification are in progress; this note does not claim visual completion.
