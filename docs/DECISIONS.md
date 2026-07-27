# DECISIONS.md

Append-only log of gameplay-number or rule changes: what changed, from what
to what, and why. One entry per change, newest at the top. This exists so
"why is this number what it is" never again requires reverse-engineering
months later — every deliberate retune or drift-resolution gets written
down when it happens.

Not for structural/architecture changes (those go in `docs/ARCHITECTURE.md`
directly, since there's only ever one current structure worth documenting).

---

## 2026-07-27 — Shield now actually blocks fireballs (bounce, still deadly after)

- **What:** filled in the mechanic PRODUCT.md already specified but that
  never existed in code (flagged as a Known Gap in ARCHITECTURE.md when the
  shield VFX went in, same day). A fireball hitting a shielded head now
  reflects instead of killing; the shielded player takes no damage from that
  hit.
- **Explicit spec correction — bounced fireballs are deadly, not harmless.**
  The original PRODUCT.md text said a bounced fireball is "no longer
  deadly." That was **changed on direct instruction**: bounced fireballs are
  now lethal to the next enemy head they touch (still never their original
  owner — that immunity is unrelated and untouched). If this reads as
  surprising later, it was a deliberate override of the original written
  spec, not a bug or a misread — see the request that prompted it.
- **Reflection math:** velocity reflects off the head-to-fireball normal
  (standard `v - 2(v·n)n`), same as bouncing off a circle. The fireball is
  also nudged just outside the shield's collision radius at the moment of
  the bounce so it can't immediately re-trigger another bounce against the
  same head next tick before it's actually moved away.
- **`FIREBALL_BOUNCE_RANGE_PX = 180`** — PRODUCT.md says "a short distance
  after the bounce" without a number. Chose ~1/5 of the normal 900px range:
  enough to actually threaten something nearby, short enough to clearly
  read as "spent" rather than a second full shot. Tunable if it feels off
  in play — log the change here, don't just edit the constant.
  `spawnPosition` is reused (reset to the bounce point) so the exact same
  distance-from-spawn check in `gameLoop.ts` works for both the normal
  range and the bounce range — no parallel tracking field needed.
- **Chain bounces are allowed, not specifically designed for.** Nothing
  stops a bounced fireball from bouncing again off a second shield (each
  bounce just resets its position/velocity/range budget the same way). Not
  explicitly requested, but a natural consequence of the collision check
  re-evaluating `state.shield` fresh on every hit rather than tracking
  "already bounced once" as a one-time-only flag. Flagging in case it turns
  out to feel wrong in practice (e.g., too easy to farm kills by clustering
  shields) — that would be a scope question, not a bug.
- **Visual:** bounced fireballs lerp from the normal fiery-orange palette
  toward black as they approach `FIREBALL_BOUNCE_RANGE_PX` (client-side
  only, cosmetic — the server's the one actually despawning it).

## 2026-07-27 — Shield VFX added; shield data was never on the wire (new feature)

- **What:** shield now draws a light blue-white glowing forcefield around
  the whole worm while active, with a slow shimmer/pulse.
- **Why it had "no visual" before:** two separate gaps, both closed here.
  (1) `Snake.state.shield` existed but was set from the raw held-input flag
  in `updateAbilityHeldState` (step 2), not the post mass-check
  `shieldActive` `tickAbilities` (step 4) actually computes — a minor
  accuracy gap, fixed by writing `shieldActive` into `state.shield` in
  `tickAbilities`'s own return. (2) `buildSnapshot` never put shield state
  on the wire for *any* snake — there was no data path to the client at all,
  which is the real reason nothing rendered.
- **How the glow achieves a "whole-body outline" look:** rather than
  computing an actual silhouette/outline path (expensive and fiddly in
  Canvas 2D), each visible segment point gets its own soft radial-gradient
  glow sized past its own radius. Since segments sit closer together
  (`SEGMENT_SPACING`) than the glow's radius, adjacent halos overlap heavily
  and blend into one continuous border rather than reading as a chain of
  separate blobs. This was a deliberate simpler-alternative call, not a
  compromise forced by lack of options — flagged here since it was
  explicitly discussed as a design trade-off.
- **Found in the process, not fixed:** shield has no actual gameplay effect
  yet — it doesn't block fireballs (PRODUCT.md specifies a bounce mechanic;
  `collision.ts` has no shield check at all). Logged as a known gap in
  `docs/ARCHITECTURE.md` §9, not fixed here — this task was scoped to the
  visual only.

## 2026-07-27 — Fireball cost retuned to 20% (was 10%)

- **What:** `FIREBALL_MASS_FRACTION` 0.10 → 0.20. Requested directly against
  PRODUCT.md (not a bug fix — an explicit retune).
- **Why:** playtest call; no other reasoning recorded beyond "change it to
  20%." If the actual motivation (e.g. fireball felt too cheap/spammy even
  with the 5s cooldown) surfaces later, worth appending here.
- **Updated:** `abilities.ts` (`FIREBALL_MASS_FRACTION` + the tick-order
  comment), `docs/PRODUCT.md`, `docs/ARCHITECTURE.md` (constants table),
  `docs/DEVELOPER_GUIDE.md`, and test names/comments in
  `tests/abilities.test.ts` / `tests/integration.test.ts`. One test
  (`tests/integration.test.ts`, the held-fire regression test) had a
  hardcoded `startMass * 0.9` assertion from the previous 10% value —
  switched it to `startMass * (1 - FIREBALL_MASS_FRACTION)` so the next
  retune doesn't require hunting down hardcoded fractions in tests again.
- Does not affect shield (1%/s) or turbo (10%/s) — those are separate
  constants that only coincidentally shared the "10%" figure with the old
  fireball cost.

## 2026-07-27 — Score + live drain HUD added (new feature)

- **What:** `SCORE: N` and `DRAIN: -X.X/s` added to the bottom-right of the
  toolbar (`public/index.html`, below the canvas).
- **Score = count of food orbs consumed, not mass gained.** Chosen because
  the feature request explicitly said "current number of food consumed."
  Mass already has its own HUD number (existing); score is a distinct,
  always-increasing counter — corpse food counts the same as a single normal
  orb (1 orb = +1 score, regardless of mass value). If a future request wants
  score to weight by orb value or add kills, that's a new decision, not an
  assumption to bake in silently.
- **Drain excludes the one-time fireball cost.** "Live ability drain" reads
  as an ongoing rate (shield/boost/turbo), not a burst spend. Showing the
  fireball's 10% cost as a momentary drain spike would be misleading — it's
  not a rate, it's a lump sum. If this reads wrong in play, that's tunable
  here, not a silent renderer change.
- Both values are server-authoritative (`World.foodEatenById`,
  `World.snakeDrainPerSecById`) and sent on the snapshot wire as `score` /
  `drainPerSec` — the client only formats and displays them.

## 2026-07-27 — Fireball cooldown actually wired up (bug fix)

- **Bug:** holding the fire key caused "strange behavior" — in practice, mass
  draining almost instantly. Fireballs also appeared to only ever fire once
  per long stretch regardless of tapping.
- **Root cause:** the client sends `fire: true` on every input packet for the
  entire duration the key is held (~45Hz), not just on the initial press.
  `Snake.state.fireballCooldown` existed in the type since the start of the
  project but was never read or written anywhere — `tickAbilities` only
  checked `alive` and `mass > 0` before spawning. Result: a held key fired
  (and paid the 10% mass cost) on every single 25Hz simulation tick.
- **Fix:** `tickAbilities` now decrements `state.fireballCooldown` by `dt`
  each tick and only allows a new fireball when it's reached zero, resetting
  it to `FIREBALL_COOLDOWN_SEC = 5` on a successful fire. This was already
  the documented PRODUCT.md rule ("5 second cooldown after a successful
  fire") — it just wasn't implemented.
- **Why this satisfies "holding should be no different than pressing":**
  with the cooldown gate, holding the key continuously produces the exact
  same result as tapping it at the optimal moment every 5 seconds — one shot
  the instant the cooldown clears, no more. A single tap and a held key
  produce identical output (see `tests/abilities.test.ts`).

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

## 2026-07-27 — Fireball no longer absorbed by its own owner's body (bug fix)

- **Bug:** fireballs only ever worked for a snake that was a single head
  segment. As soon as a snake had any body (length > 1), pressing fire spent
  the mass but no fireball appeared.
- **Root cause:** same shape as the head-lethality bug above, but in the
  body-hit branch of `resolveCollisions`. A fireball spawns at the owner's
  head; the owner's second segment sits `SEGMENT_SPACING` (10 units) away —
  much closer than the fireball's own blast radius (which scales with mass
  and is often 15-30+ units). The body-hit loop didn't exclude the
  fireball's own owner, so it was removed as "absorbed by a body hit" on the
  same tick it spawned, every time, for any snake with a body.
- **Fix:** exclude `fb.ownerId` from body-hit candidates too, mirroring the
  head-hit fix. Also corrected PRODUCT.md's combat table, which said
  "Fireball ↔ body (any)" — ambiguous, and read literally, wrong; changed to
  explicitly say "enemy body" and added a row stating a fireball never
  interacts with its own owner at all (head or body).

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
