# Project instructions

This public repository contains an independent browser-based GTHA transit planner. The approved scope is transit planning, map/place search, live TTC status, local saved trips, accessible multilingual presentation and documentation, together with the shared interface feature set tracked in `docs/interface/feature-audit.json`.

The owner previously deferred the general-purpose interface features and has since asked for all of them except a local file converter and a local model-runner manager, which remain out of scope and are recorded as such in the audit. Desktop installers remain deferred: this ships as a website.

The navigation is the Material navigation rail on wide screens, the bottom bar with its More dialog on phones, and the base-ui tabs in settings. A browser-style tab strip replaced them for one deployment in September 2026, made the interface unusable on phones and cluttered the rail, and the owner asked for the previous design back on 9 September 2026. Do not mount `components/tab-strip.tsx` in the navigation or the settings again without a new decision from the owner; the component, its state model and its tests stay in the tree for that day, and `docs/interface/feature-audit.json` records the decision.

`components/ui/` holds a large vendored component set of which one file is used. Every shipped surface is hand-written over native `dialog`, `details` and `fieldset` elements with this project's own Material tokens, and new surfaces follow that idiom rather than adopting the vendored one, which has never been type-checked in this build. `react-day-picker` is a real dependency and may be used directly.

Preserve user data and unrelated work. Never commit secrets, local addresses, downloaded feed archives, map databases, dependency directories or generated caches. Public records use ordinary professional language. Do not copy private conversational vocabulary into this repository.

Frontend ownership stays with the site-owning agent. Independent backend/data modules may be developed in isolated worktrees. Run meaningful local checks and verify the real routing engine before describing a journey as working. Never seed illustrative transit schedules or coordinates as production data.

Official data must carry publisher URLs, licences, retrieval times, calendar coverage and checksums. Failed refreshes retain the previous validated graph. Never equate a successful HTTP fetch with complete agency coverage. Distinguish data receipt time from the last time a publisher changed an alert.

The production frontend is a Node container serving a static export, with a private routing origin and map origin. Domain/tunnel configuration is owner-managed. Do not modify unrelated host services or publish private infrastructure details.

For UI verification use the owner's required isolated headless route, with real screenshots and layout measurements. Do not claim physical touch-device verification from browser emulation.

## Agent conversation vocabulary

Agents working in this repository use the shared private conversation vocabulary defined in
the maintainer's canonical agent instructions for every reply, including chat prose, visible
reasoning, status lines, and task or session titles. Read those instructions and apply them
in full. They are deliberately not restated here, because this file is part of this
repository's public record.

That vocabulary never appears in anything published. Keep it out of commit messages, branch
names, code, code comments, test names, documentation, this file, issues, pull requests,
discussions, release notes, published sites, logs, and every other file in this repository.
Published writing uses ordinary professional English, and exact technical identifiers always
keep their literal spelling. The single documented public-safe exception is named in those
canonical instructions; do not infer any other.

Scan any text bound for a public surface against that vocabulary before publishing it. A
reviewer cannot tell a correct release note from a leaking one by reading it, so the scan is
a step, not a habit.
