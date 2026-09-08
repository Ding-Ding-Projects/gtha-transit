# Command palette

<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> opens a palette over whatever you are
doing. It searches every destination, every setting and the handful of things that
are actions rather than values, and a result either changes the value where it
stands or takes you to the exact control and puts the focus on it.

Landing on the page that contains a control and leaving somebody to find it is not
what this is for. If the palette can name a thing, it can reach it.

## Opening and closing

| | |
| --- | --- |
| Open | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>, or <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> on a Mac |
| Close | <kbd>Esc</kbd>, the close button, or the same shortcut again |
| Move between rows | <kbd>↑</kbd> <kbd>↓</kbd>, <kbd>Home</kbd>, <kbd>End</kbd> |
| Enter a row's own control | <kbd>Tab</kbd> |
| Go, or run | <kbd>Enter</kbd> |

The shortcut is matched on the physical key as well as the character, so a
non-Latin keyboard layout reaches it too. It is deliberately not <kbd>Ctrl</kbd>+<kbd>F</kbd>,
which belongs to the browser, and not <kbd>Ctrl</kbd>+<kbd>K</kbd>, which this
project used to reach for and no longer does.

Arrow keys move between rows and <kbd>Tab</kbd> steps into one. That split is the
point: a row carrying a live slider would otherwise trap the keyboard on every row
between here and the one you wanted.

Closing puts the focus back where it came from.

## What it can reach

**Every destination.** All nine, from the same registry the rail, the phone bar
and the More dialog read. The phone bar shows four because a phone cannot show
nine at a size anyone can hit; the palette has no such problem and lists them all.

**Every setting.** From the same catalog the settings workspace itself renders.
The palette cannot list a setting that does not exist, and it cannot miss one that
does, because there is one list rather than two.

**Three actions.** Switch the theme, and reset either playfulness slider to the
level it ships at. An action runs and the palette stays open, because it changes
something you can see from here and you may well want another. Anything with a
target closes first, since staying would leave the palette covering the thing you
asked to see.

## Rows are controls, not printouts

A settings row renders its real control inline — the theme choice, the language
choice, both playfulness sliders, the narration switch, the narration language,
the rate, the pitch, the quiet switch. Changing it here is the same change made on
the settings page, through the same setter, with the same validation and the same
persistence. Two paths to one value cannot disagree about what that value is,
because there is only one piece of code behind both.

Two kinds of row deliberately do not carry their control, and each says so rather
than showing an inert box:

- **Prose.** The three privacy cards explain what the planner keeps, what a shared
  link carries and where the answers come from. There is nothing to change.
- **A choice with more than four options.** The installed-voice lists can run to
  dozens. A dropdown that long would need its own search field and regex builder
  to meet this project's own contract for a dropdown, and building one inside a
  palette row is out of proportion to the problem. The row says the full control
  is on the settings surface and takes you to it.

A control that cannot be operated right now names the condition rather than
appearing broken: no speech synthesis in this browser, narration switched off,
voices still loading, or no voice for that language installed on this computer.
The order matters — telling somebody to turn narration on in a browser that cannot
speak wastes their time.

## Searching

Plain text is the default and the regular-expression builder is an explicit
opt-in, exactly as it is at every other search field in the planner. The matching
is the same code, so the palette and the search bar six inches away from it cannot
answer differently. See [the regular-expression workbench](../search/regex-builder.md).

Rows are searchable by everything they show, plus the words people actually use
that the interface does not: `dark mode` finds the colour theme, `mute` finds
quiet narration, `analytics` finds the privacy card that mentions it.

An empty result says so in words and suggests what does work. A pattern the engine
rejects says that instead, and never silently returns nothing.

## Size

Two sizes: a bounded card, which is what it ships as, and a full window. The
choice is remembered in this browser. If it cannot be saved — a private window,
storage switched off — the palette says so and still works for the visit.

## Landing

Choosing a settings row switches to the settings destination, opens the section
that setting belongs to, unfolds anything collapsed over the control, scrolls it
into view, focuses it and outlines it for a moment.

The outline is an outline rather than an animation, so it reads the same whether
or not the visitor has asked for reduced motion. There is nothing to switch off,
because nothing moves. Scrolling is instant for the same reason: this is a jump,
not a journey.

Where a control is disabled, the focus lands on the group that holds it, since a
disabled element cannot take focus and silently doing nothing would look like the
palette failing.

## Language, tone and accessibility

The palette obeys the three language modes and both playfulness sliders like every
other surface. What the sliders never touch are the facts: a setting's current
value, a result count, and the reason a control cannot be operated all read the
same at every level.

Every row is reachable and operable from the keyboard with a visible focus ring.
The result count is announced politely rather than on every keystroke. Targets are
at least 44px. The list scrolls inside the dialog rather than the page behind it,
and on a narrow window the tools move under the title instead of squeezing it.

## A limitation worth stating

The glyphs come from a subset icon font, vendored locally, containing exactly the
names asked for at vendoring time. A ligature font answers a name it does not
carry by rendering the English word at icon size — which looks like unfinished
copy and never throws. So the palette uses names the shipped file actually has: a
padlock would suit the privacy rows better than a tick, and there is no padlock in
the subset. `tests/command-palette.test.mjs` checks every name the palette can
emit against the manifest of the binary that shipped, so this cannot rot quietly.

## Verification

`tests/command-palette.test.mjs`, 25 checks. Beyond the ordinary ones, seven
boundaries were broken on purpose and watched go red before being restored:

| Boundary removed | Caught by |
| --- | --- |
| The settings workspace stops reading the shared catalog | the one-list guard |
| A glyph the shipped subset does not carry | the font manifest check |
| The navigation grows its own destination list again | the registry guard |
| The palette stops being rendered in the shell | the wiring guard |
| A destination id is renamed under the workspace | the hand-written roster |
| A destination is dropped entirely | the hand-written roster |
| A setting id drifts from its keywords | the keyword coverage check |

The roster is written by hand rather than derived. Deriving it would let a
renamed destination rename the expectation with it, and a destination that
disappeared entirely would disappear from the check too.
