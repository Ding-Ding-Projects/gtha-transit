# Race rooms

A race room is a short-lived shared game: a leader opens one, teams join by a six-character code, and the room records what each team actually did. It is not an account system, and it is deliberately small.

## What a room holds

| Piece | Bound |
| --- | ---: |
| Teams | 12 |
| Participants | 60 |
| Check-ins | 600 |
| Photos | 120, at most 400 KB each |
| Lifetime | 12 hours by default, 48 at most |

Every bound is enforced on write, and expired rooms are purged before a new one is created. When a room expires, its teams, participants, check-ins and photos go with it.

## Who may do what

The leader holds a secret returned once, at creation, and only the leader may add a team, assign routes or start the race. Each participant holds their own secret, returned once when they join, and only they may change their own sharing or record their own check-in. **Neither secret is stored in the clear** — the room keeps a hash — and neither ever appears in the readable view of a room.

The join code is six characters from an alphabet with the ambiguous letters left out, so it can be read aloud.

## Positions

Position sharing is **off until a participant turns it on**, and stopping it clears the stored position rather than merely hiding it. A position outside the valid coordinate range is refused rather than stored. The readable view shows a position only for a participant who is currently sharing.

## Photos

A photo is accepted only as a re-encoded JPEG, verified by its own leading bytes rather than by the name it was given, and bounded in size and count. Photo bytes never appear in the readable view of a room; they are served from their own route, for that room only, with a content policy that forbids the browser from treating them as anything but an image. A photo identifier from one room never returns a photo from another.

## What a check-in is

A check-in records that a participant said they were somewhere at a time, with the coordinates and measured distance they chose to include, and optionally a photo. **It is an observation, not a verification.** Nothing here checks that a photo shows the place it claims, and the interface must never say otherwise.

Suggested articles: [passenger guide](../planning/README.md).
