# Toy locks, the unlock ladder, the authenticator and Support Tickets

A person can put a speed bump in front of part of their own planner: a saved
trip, a settings section, or the appearance studio. It is for fun. The planner
says so on every surface that creates or opens a lock, and it never describes a
lock as protecting, securing or encrypting anything.

> **This lock is for fun. It is a speed bump in this browser, not protection for
> anything.** Forgot it? Clear this site's data in your browser settings and every
> lock is gone. That also clears your saved trips and settings.

## What can be locked

| Surface | Target id | Where the lock is set |
| --- | --- | --- |
| Each saved trip | `saved-trip:<trip id>` | The lock button on the trip card, or its right-click menu |
| Appearance, Language, Comfort and Narrator settings | `settings-section:<section>` | The bar at the top of the section, or **Settings > Privacy > Toy locks** |
| The appearance studio | `appearance-studio:studio` | The bar above the studio, inside the Appearance section |
| The change history | `history:secret-history` | The history card, which does not open until it has a lock |

**The Privacy section cannot be locked.** It holds the list of locks, Support
Tickets and the recovery line, and a lock in front of the way out of locks would
be a wall. School mode's own card also sits outside the Comfort section's lock,
for the same reason: one lock never stands in front of the way out of another.

## The six policies

PIN; password; PIN then password; password then authenticator code; PIN then
authenticator code; password then PIN then authenticator code. The order is
written out in `POLICY_FACTORS` rather than derived from the name, and the prompt
asks for the factors in that order.

**Every lock is its own lock.** Each has its own policy, its own salt and its own
credential set. There is no master credential, a grant for one lock never opens
another, a surface cannot carry two locks, and a nested lock (the studio inside a
locked Appearance section) is two locks with two answers.

## How credentials are kept

- A PIN or password is stored as PBKDF2-HMAC-SHA256 over a random 16-byte salt,
  50,000 iterations, never as the value. The derivation is the same plain
  JavaScript School mode uses (`lib/pbkdf2.ts`), so it works on every origin,
  including plain-HTTP LAN addresses where `crypto.subtle` does not exist. Only
  the salt comes from `crypto.getRandomValues`, which needs no secure context.
  Where even that is missing, the wizard says a key cannot be made rather than
  inventing one.
- An authenticator key cannot be hashed, because the code is computed from it. It
  lives in its own record (`gtha-toy-lock-otp-v1`), separate from the lock list
  (`gtha-toy-locks-v1`), so the list can be exported, searched and recorded in
  history without carrying anything usable.
- Unlock grants are held in memory only. **Every lock is locked when the planner
  next opens.** The unlock duration is the person's choice: until they leave the
  page, a number of minutes (1 to 240), or until the planner is closed.
- A stored lock whose credential is missing is dropped and counted, never
  restored as a weaker lock and never left as a lock nobody can open. The lock
  list says how many were dropped.

## Locked means refused

While locked, a surface's content is `inert`: pointer, keyboard, touch and
assistive-technology activation cannot reach it and it cannot take focus. The
gate also refuses the programmatic route: click, pointer-down, key-down, input,
change, submit, drag-start and drop events are stopped in the capture phase at
the gate and open the unlock prompt instead. The content stays visible and dimmed,
so what is locked is never a mystery.

**In the settings search and the command palette**, a locked row stays listed,
its value reads *locked*, its control becomes inert (the palette has no setter to
call), and its teleport lands on the lock's own **Unlock** button rather than on
the control the lock is refusing. `lockCovering` in `lib/settings-catalog.ts`
decides which lock covers a row.

A shut lock cannot be removed from the lock list. The list sends the person to
the surface to unlock it first; removal, once open, goes through the two-key
confirmation gate.

## The unlock prompt

Anchored inline under the bar that names the lock, not in a detached dialog. It
states the policy and the step ("Step 2 of 3: PIN"), and for a PIN offers both a
keypad and a typed field. The keypad has Backspace and Clear, 52 px keys, and an
explicit **Shuffle the keypad** choice; it only fills the same field, so both
routes reach the single `submitFactor` call and spend the same attempt budget.
Escape and **Cancel** close it and return focus to the bar.

A wrong answer spends one attempt and sends the attempt back to its first factor,
so a multi-factor lock cannot be walked one factor at a time. Verified factors are
kept for two minutes while the next is typed, then the steps start again. Five
wrong answers start a wait of 30 seconds that doubles with each consecutive
lockout, capped at 30 minutes. A wait deletes nothing and escalates nothing.

The prompt always carries the disclosure, the recovery line and **Forgotten your
password? Open a support ticket**.

## The unlock ladder

While a wait runs, **Play instead of waiting** offers dim sum (one dish, four
choices), then after five wrong dishes ten easy sums, then after one wrong sum
whack-a-mole, then the clock.

The five rules, each with a test in `tests/unlock-ladder.test.mjs` named
`NEVER 1` to `NEVER 5`:

1. **It clears the wait, never the credential.** `clearWait` returns an attempt
   state and nothing else. The module has no route to a grant, a credential,
   storage or a cookie, and the test reads its source to prove it.
2. **It never refunds more than the clock.** Clearing sets exactly the budget a
   served wait sets.
3. **It is budgeted.** At most three waits skipped per rolling hour across every
   lock in this browser, persisted so a reload does not refill it.
4. **It never slows the escalation.** The lockout count is left alone, so the
   next wall is as long as it would have been.
5. **Answers are graded against single-use nonces**, consumed before grading, and
   challenges expire after five minutes.

A mole round submitted before its own 20 seconds have elapsed is lost, and each
mole counts once, only in its own cell, only while it was visible. The round runs
on the grader's clock, and the ladder for a lockout is kept for the life of the
page, so closing and reopening the prompt continues the same round and the same
rung rather than dealing a fresh one.

**Under School mode the ladder starts at the sums.** The dim sum rung is absent,
not skipped with a message, and the dish pictures are not even requested.
Somebody who cannot see the picture can choose **Do the sums instead**, which
withdraws the picture question and gains nothing.

Moles are playable from the keyboard: keys 1 to 9 hit the matching cell. The score
is announced as it changes and the time left is written as a number. Under reduced
motion the moles appear without popping.

### Where the contract cannot apply literally

The contract asks for every answer to be generated and graded on a server. That
rule exists so a script cannot skip a lockout a server enforces. These locks,
their attempt budgets and their waits all live in the same browser storage the
visitor can clear, which is also the documented way out, so a server grader would
guard nothing a person could not already walk around, and would add a network
request to a feature that otherwise makes none. The shipped equivalent keeps every
answer inside the grader's closure (`createLadderSession`), never in anything the
rendering layer receives, and enforces every other rule above.

## Registering an authenticator code on a lock

The wizard generates a 20-byte key locally, shows it only behind **Show the key**,
states the algorithm, digit count and period, and offers **Copy key** and **Copy
otpauth link**. The factor arms only after the current code is typed back.

**No QR code is drawn.** This project has no QR generator among its dependencies,
and it will not send a key to an online QR service to render one. The wizard says
so and offers the key and the link instead.

## The authenticator

**Settings > Privacy > Authenticator.** Entries come from a pasted
`otpauth://totp/` link, whose parameters are honoured exactly, or by hand with
issuer, account, base32 key, algorithm (SHA-1, SHA-256, SHA-512), 6 to 8 digits
and a period. Each row shows the current code in large grouped digits, a copy
button, the seconds left written as a number, and a peek at the next code. The
code region announces when the code changes, not every second. Entries can be
searched with the regular-expression workbench, moved up and down, renamed,
grouped, selected and removed in bulk through the two-key gate.

RFC 6238 TOTP over RFC 4226 HOTP, verified against the RFC 6238 Appendix B vectors
for all three algorithms and the RFC 4226 HOTP table in `tests/totp.test.mjs`,
plus a differential check against `node:crypto`. A code is accepted one period
either side of now.

- **Keys are kept in this browser's own storage**, which anybody using this
  browser can read. A web page cannot reach an operating-system credential vault;
  the card says so beside the list.
- **The ordinary export omits every key** and says so on every row. There is no
  export that includes keys.
- **Clock skew cannot be detected.** A web page with no network has no second
  clock to compare with, so the card shows the device clock in UTC and says to
  check it first when a code is refused, rather than claiming to know.
- **Reading a QR code from a picture or a camera is not available**, for the
  same reason no QR is drawn.

## Support Tickets

**Settings > Privacy > Support Tickets**, reached also from every unlock prompt's
*Forgotten your password?* link and from the settings search. A ticket form with a
category, a severity that will not be honoured, and a description; a locally
generated `DESK-` number; a status that advances when chased (Received, Triaged,
Escalated to the folder, Resolved); and a canned reply written in advance.

Resolution is the only part that works. A web page cannot open the browser's
settings or clear its own site data, so the resolved ticket lists the steps, shows
this site's address with a copy button, and deletes nothing itself.

One line sits outside the comedy, rendered plainly at every funny level:

> Nothing is sent anywhere. This ticket exists only in this browser, no network
> request is made, no data is collected, and nobody is reading it.

Tickets are searchable, exportable as JSON, and deletable in bulk through the
two-key gate. They are cleared by exactly the site-data deletion they point at.

## The change history

**Settings > Privacy > Change history.** An append-only record of authenticator
entries added, changed or removed; the display name changed or reset (recorded
wherever it happens: the studio, the settings search, the palette or a restore);
and locks created or removed. Labels, prunes and restores are new records, never
edits.

- Each record carries the SHA-256 of the one before, and the card says whether the
  chain checks out or where it breaks.
- **No record holds a secret.** A record naming a credential field is refused, and
  so is one whose text contains any key the store currently holds.
- **A mutation the history cannot record is not made.** Adding, changing or
  removing an authenticator entry writes the history first; if that fails the
  entry list is left as it was and the card says so.
- It opens only behind its own lock, which it asks for before showing anything.
- Search, filter by action and by date, label, restore an earlier display name,
  prune to the newest 50, 200 or 500 through the two-key gate, and export redacted
  JSON that states what it never contains.

### Where the contract cannot apply literally

The contract asks for a local Git repository in the application-data directory
with encrypted snapshots keyed from the operating-system credential vault. A
browser has none of those. The equivalent is a hash-chained, append-only log in
this origin's storage without snapshots, which is why restore covers the display
name (whose earlier values are not secret and are in the log) and not
authenticator keys.

## What is not done

- **Not every rendered element can be locked.** The contract asks for a lock
  wizard on every element; this ships it for saved trips, four settings sections,
  the appearance studio and the history. Individual controls, tabs and appearance
  properties are not lockable targets.
- **No bulk lock wizard.** `createLocks` in `lib/toy-locks.ts` makes independent
  locks for several targets, but no surface offers it yet.
- **Tabbed-navigation lock rules** do not apply: the browser-style tab strip is not
  mounted, by owner decision (see `AGENTS.md`).
- **No QR drawing or reading**, as above.
- **Not yet driven in the built artifact.** The rules are covered by unit tests
  and source guards; no capture or built-page interaction proof exists yet.

## Verification

| Suite | Tests |
| --- | --- |
| `tests/totp.test.mjs` | 17 |
| `tests/toy-locks.test.mjs` | 22 |
| `tests/unlock-ladder.test.mjs` | 18 |
| `tests/support-tickets.test.mjs` (tickets, authenticator entries and history) | 15 |
| `tests/lock-surfaces.test.mjs` | 17 |

**Twenty-eight rules were broken on purpose and watched go red, then restored and
watched go green**: the ladder refunding the escalation, ignoring its hourly
budget, grading before consuming the nonce, accepting a mole round early,
counting a mole twice, refunding extra attempts, and starting at dim sum under
School mode; a PIN kept in plain text, a constant salt, a wrong answer keeping
the verified factor, a factor outside the policy accepted, a broken record
restored, and a hash in the export; the skew window widened and the HOTP counter's
high word dropped; the history accepting a credential field or a pasted key; the
authenticator export carrying keys; a locked settings row keeping its setter or
leaving the search; a shut lock removable, and a cleared ladder granting the lock;
the gate no longer refusing clicks or no longer inert; the Privacy section gated;
the ticket disclosure replaced; the desk making a network call; and lock copy
claiming protection.

Three of those passed on the first attempt and were fixed rather than accepted:

- **Counting a mole twice** was first broken by removing the duplicate check, but
  the hits already went into a set, so the rule held twice over and the break
  changed nothing. The break now gives each hit a fresh key, and the test sees 50
  hits where there was one mole.
- **A factor outside the policy** was first checked only against a lock that had
  no such hash, so the missing hash refused it on its own. The test now edits a
  PIN hash into a password-only record, and the policy has to do the refusing.
- **The Privacy section guard** matched nothing at all: a script had written its
  regular expression's word boundary as a literal backspace character. It is
  fixed, and a new test refuses any control character in the lock sources and
  tests.
