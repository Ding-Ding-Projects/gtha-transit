# School mode

Plain English, with the playful parts put away, behind a word only the person who
set it knows. It ships off and nothing turns it on but somebody choosing to.

## It omits; it does not disable

While the mode is on, five things behave as though they were never installed:

| | Where it goes from |
| --- | --- |
| Cantonese | The navigation language buttons, the settings Language tab |
| Both languages | The same two |
| Both playfulness sliders | The settings Language tab |
| Your own wording | The Comfort section |
| The dim sum surprise | It simply does not draw |

Not greyed out. A disabled switch still reads **Cantonese** to everybody who can
see the screen, which is precisely what somebody switching this on did not want.
The whole Language tab leaves the strip rather than staying empty, and somebody
who was sitting on that tab when the mode came on lands on Appearance rather than
on a tab that no longer exists.

`SUPPRESSED` in `lib/school-mode.ts` names all five in one list, so a new surface
has one place to ask and a reviewer has one place to read.

**And it leaves the settings search and the command palette at the same moment.**
`HIDDEN_BY_SCHOOL` in `lib/settings-catalog.ts` removes those rows from the one
registry both readers use. A row hidden in the workspace but left in the catalog
is a control the palette can still teleport straight to, which would make the
whole thing decorative.

## Nothing anybody chose is overwritten

The mode is *read through*, never written back:

```
shownLang  = effectiveLanguage(school, lang)
shownFunEn = effectiveFunLevel(school, funEn)
```

Somebody's Cantonese choice and their two playfulness levels sit untouched in
their own settings and come back the moment the mode goes off. A loaded wording
file is not cleared either — it is simply not applied, and it returns with its
card. Overwriting would turn a temporary mode into a permanent edit of somebody's
preferences, which is a far worse thing than the mode it was implementing.

## Renaming it takes the shipped name away

Somebody who calls it *Exam mode* gets that name in the card heading, the button,
the on-state line, the settings search result and the palette row. Nothing says
*School mode* again anywhere. A rename that leaked the original name in one
tooltip would defeat the rename entirely, so the test asserts the shipped name
appears nowhere in the catalog once a name has been chosen.

## It is a speed bump, not a lock on your data

Said in those words on the control itself, next to the field that sets it.

The credential is a PBKDF2-SHA256 hash at 210,000 iterations over a random
16-byte salt, in this browser's own storage. The word itself is never stored,
never logged, never exported and never in a capture. Two locks with the same word
store different hashes, because each is salted.

None of which makes it a protection, and the copy never says it is:

> **This is a speed bump, not a lock on your data.** Clearing this site's data in
> your browser turns it off. That also clears your saved trips and settings.

Anybody with the browser can clear site data. Forgetting the word is a normal
outcome for a lock somebody set on themselves, so the way out is written where
they set it rather than left to be discovered — and what it costs them is written
beside it, because a recovery route that quietly deletes their saved trips is not
a recovery route.

**A record that claims to be on with no credential restores as off.** That is the
one failure this must never have: being shut out of your own planner by a corrupt
storage record is not a speed bump, it is a wall.

## Where a contract cannot apply literally

The universal contract asks for one shared application-data record across every
app on a machine, propagating live, with the credential in the operating-system
vault. A browser has neither a shared application-data location nor a credential
vault, and cannot reach one.

The equivalent shipped here is honest about that rather than silently short: the
record is this origin's own `localStorage`, the credential is a salted hash in it,
and the recovery route is clearing site data — which is exactly the reset the
contract names, in the only store a browser has. What is genuinely not provided is
propagation to a sibling application, because there is no sibling application to
propagate to.

## Verification

`tests/school-mode.test.mjs` — 26 tests over the lock, the name, the suppression
list, persistence, and the omission at every surface.

**Seventeen boundaries were broken on purpose and watched go red**, then restored
and watched go green: the catalog filter removed; a row dropped off
`HIDDEN_BY_SCHOOL`; the row's label pinned to the shipped name; the Language tab
and its panel left in the strip; the stored-tab fallback removed; the navigation
language buttons and the wording card left rendered; `shownLang` reading the raw
setting; the replacer applied under the mode; dim sum unsuppressed; the salt made
constant; the playfulness override removed; the orphan-record guard removed; the
recovery line taken off the control; and a secret field left in the clear.

Two of those seventeen passed on the first attempt and were fixed rather than
accepted:

- **Looping over `HIDDEN_BY_SCHOOL`** meant shortening the list simply checked
  fewer things. A guard shaped that way catches a row done wrongly and never a row
  taken off the list. It now asserts the exact expected four.
- **Matching `type="password"` once** passed while the *other* secret field was in
  the clear. It now counts both.

Two existing guards also caught this change and were updated rather than
loosened: the one pinning the replacer's position inside `t`, and the one pinning
dim sum's suppression expression.
