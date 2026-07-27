# DECISIONS.md

Append-only log of gameplay-number or rule changes: what changed, from what
to what, and why. One entry per change, newest at the top. This exists so
"why is this number what it is" never again requires reverse-engineering
months later — every deliberate retune or drift-resolution gets written
down when it happens.

Not for structural/architecture changes (those go in `docs/ARCHITECTURE.md`
directly, since there's only ever one current structure worth documenting).

---

## 2026-07-27 — Fireball never lethal to its own owner (bug fix)

- **Bug:** pressing fire made the shooter's own worm disappear instantly, and
  the fireball never appeared to launch.
- **Root cause:** `resolveCollisions` in `collision.ts` checked a fireball
  against every alive head, including its own owner's. A fireball spawns at
  the owner's head position; even after one tick of travel it's usually still
  overlapping that same head (its radius plus the head's radius outlasts the
  small distance traveled in one tick at typical fireball speed/tick rate).
  So every fireball killed its shooter on the same tick it was created, then
  got removed as "consumed" — which is also why it looked like the fireball
  was never drawn.
- **Fix:** exclude `fb.ownerId` from the head-hit candidates in the fireball
  collision loop. This was already the documented rule (PRODUCT.md's combat
  table says "Fireball ↔ **enemy** head") — the code just didn't implement it.
- Regression test added: `tests/collision.test.ts` — "fireball never kills its
  own owner, even overlapping the owner head at spawn." The old test that
  encoded the bug (`ownerId` equal to the victim's own id) was corrected to
  use a distinct owner/victim, since it was unintentionally asserting the bug
  as correct behavior.

## 2026-07-27 — Fireball range/fade-out added (new rule)

- **What:** fireballs now despawn after traveling `FIREBALL_MAX_RANGE_PX =
  900` world units from their spawn point, fading out (client-side, cosmetic)
  over the last ~30% of that distance rather than popping.
- **Why 900:** the map is a 12,000-unit-diameter circle (`bounds.radius =
  6000`). A typical zoomed-in screen shows roughly 900-1800 world units of
  width depending on zoom/DPR. 900 lands at "real range, roughly half a
  screen at default zoom" per the product ask, while staying well under 10%
  of the map diameter — not sniping across the whole arena.
- **Not yet in PRODUCT.md before this:** fireball range was previously
  unspecified (fireballs traveled forever until they hit something or left
  loaded chunks). Added to PRODUCT.md's Fireball section in the same change.
- **Tunable:** if 900 feels wrong in play, that's a new entry here, not a
  silent code change.

## 2026-07-27 — Fireball cost & shield drain reconciled to PRODUCT.md

- **Fireball mass cost:** code had `FIREBALL_MASS_FRACTION = 0.25` (25%),
  PRODUCT.md specified 10%. Resolved: code updated to `0.10` — spec wins.
- **Shield drain:** code had `SHIELD_DRAIN_PER_SEC = 0.05` (5%/s), PRODUCT.md
  specified 1%/s. Resolved: code updated to `0.01` — spec wins.
- **Why it drifted:** earlier gameplay changes were made directly in code
  (via a different coding agent, based on real playtest feel) without a
  matching update to the spec docs. It went unnoticed until this harness
  cleanup cross-checked constants against PRODUCT.md.
- **Follow-up:** if 10% fireball / 1% shield feels wrong in play, that's a
  new decision to log here — don't just change the code again silently.
