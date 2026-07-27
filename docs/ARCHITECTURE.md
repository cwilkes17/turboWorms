# ARCHITECTURE.md

**Purpose of this file:** this is the harness doc that tells an agent (or a
human) *how the code is organized* — modules, data flow, invariants — so a
feature request can be implemented correctly without re-deriving the whole
system from scratch. It describes the codebase **as it actually exists
today**, verified against source, not aspirational.

Paired doc: **`docs/PRODUCT.md`** — *what* the game should do (rules, feel,
numbers). This file is *how* it's built. If you're implementing a behavior
change, check PRODUCT.md first; if you're implementing a structural change
(new module, changed data flow, changed tick order), this file is the one to
update.

---

## 1. What this project is

**turboWorms** — multiplayer snake/worm arena. Authoritative Node server runs
the simulation; clients send intent only and render JSON snapshots on
Canvas. No game engine — plain TypeScript modules orchestrated by
`gameLoop.ts`, driven by `server.ts`.

## 2. Stack

| Piece | Choice |
|---|---|
| Language | TypeScript, Node ES modules (`--experimental-strip-types`, no `tsc` step) |
| Networking | `ws` (WebSocket) |
| Browser bundle | `esbuild` → `public/client.bundle.js` |
| Tests | `node:test`, run via `node --experimental-strip-types --test tests/*.test.ts` |

Run: `npm install && npm start` → `http://localhost:8765/`.

## 3. Repo map

```
contracts/          # Types only — World, Snake, input, food shapes. No runtime logic.
movement.ts          # Head + rope body, steering rate limit
food.ts              # Spawn fields, Brownian drift, vacuum pull, tickFood
abilities.ts         # tickAbilities — fireball spawn, shield/boost/turbo costs
collision.ts         # Grid-based collisions, food pickup, death drops
gameLoop.ts          # tick(world, inputs, dt) — the one place tick order is defined
server.ts            # HTTP static + WS, sessions, buildSnapshot, broadcast
renderer.ts          # Canvas GameRenderer + parseGameSnapshot (browser)
public/              # index.html, client-entry.ts (input loop + WS), client.bundle.js (built, gitignored)
tests/               # one test file per module + integration.test.ts + snapshot.food.test.ts
docs/                # PRODUCT.md, ARCHITECTURE.md (this file), DEVELOPER_GUIDE.md, archive/
plans/               # bug_food_visibilty.md (active), archive/ (superseded per-feature build plans)
```

**Split rule:** `contracts/` = shared shapes, no logic. Systems
(`movement`, `food`, `abilities`, `collision`) = pure functions over data, no
hidden globals. `gameLoop.ts` = only place that defines tick order and wires
systems to `World`.

## 4. Data flow

```
client-entry.ts --WS input--> server.ts --> gameLoop.tick(world, inputs, dt)
                                                 |
                                          mutates World
                                                 |
server.ts buildSnapshot(world) --WS snap--> renderer.ts (GameRenderer)
```

1. Client opens WebSocket, gets `{ t: "welcome", id, tickHz, bounds }`.
2. Client sends `{ t: "input", d: PlayerInput }` (~45 Hz).
3. Server runs `tick(world, inputs, dt)` at `TICK_HZ` (20–30, default 25).
4. Server broadcasts `{ t: "snap", ... }` = `buildSnapshot(world)`.
5. Client `parseGameSnapshot` → `GameRenderer.pushSnapshot` → RAF draw loop, linear interpolation between snaps.

**Rule of thumb:** anything that changes who wins, positions, or resources →
server/tick. Anything that only changes how it looks → `renderer.ts`.

## 5. World — the one source of truth

`contracts/world.ts`. Everything mutable hangs off `World`:

| Field | Role |
|---|---|
| `bounds` | Circular arena metadata |
| `spawnFields` | Static food regions |
| `snakes[]` | Segments, direction (radians), speed, alive, state |
| `food[]` | Drifting orbs |
| `fireballs[]` | Projectiles |
| `snakeMassById` | **Authoritative** mass map — source of truth for resource pool |
| `foodRng`, `foodNextOrbId`, `foodSpawnAccumSec` | Food subsystem counters |
| `nextFireballId`, `nextFoodSpawnId` | Id allocators |
| `tick` | Monotonic frame index |

`snakeMassById` is the resource pool; `applyMassLengthSync` in `gameLoop.ts`
adjusts segment count from mass (`MASS_PER_SEGMENT = 10`).

## 6. The tick pipeline (do not reorder without a reason)

Implemented in `tick()` in `gameLoop.ts`:

| Step | What runs |
|---|---|
| 1 | `applyInputs` — merge facing; `steerHeadingToward` caps turn rate |
| 2 | `updateAbilityHeldState` — e.g. shield held flag |
| 3 | `simulateMovement` — head + rope; boost/turbo is a speed *preview*, not persisted on the snake |
| 4 | `tickAbilities` per snake — fireball spawn, mass drains, appends `fireballsSpawned` |
| 4b | `integrateFireballs` — linear motion for the tick, then drops any fireball that has traveled past `FIREBALL_MAX_RANGE_PX` from its `spawnPosition` |
| 5 | `resolveCollisions` — fireball vs snakes, head vs head, head vs enemy body, head vs food, deaths → corpse orbs |
| 6 | `tickFood` with `consumeWithHeads: false` — Brownian + spawns + head vacuum (eating already handled in step 5) |
| 7 | `applyMassLengthSync` — grow/shrink segments to match mass |

If a change needs a new global pass, justify where it lives in `tick()` vs
inside a subsystem — don't bolt logic onto step order without updating this
table.

## 7. Module reference

- **`movement.ts`** — `simulateMovement` (head along `cos/sin(dir)*speed*dt`, body re-spaced at `SEGMENT_SPACING`); `steerHeadingToward` (turn-rate cap, `DEFAULT_HEAD_TURN_RAD_PER_SEC = 12`).
- **`abilities.ts`** — `tickAbilities`. Order per tick: fireball cost (gated by `state.fireballCooldown`) → shield drain → turbo/boost drain → clamp mass. See constants table below.
  - `fireballTriggered` reflects whatever the client last sent, which is `true` for the *entire* time the key is held (~45Hz input send rate), not just the initial press. The cooldown gate (not just alive/mass checks) is what makes holding the key equivalent to tapping it exactly on cadence — without it, a held key fires (and pays the mass cost) on every single tick. Fixed 2026-07-27; `Snake.state.fireballCooldown` existed in the type from the start but was never read or written until then.
- **`collision.ts`** — `resolveCollisions`, uniform grid over segments + circle tests. Self body never kills the owner (intentional); enemy body kills the attacking head. A fireball's own owner is filtered out of **both** its head-hit and body-hit candidates for the same reason — a fireball spawns at the owner's head, so with any body segments at all it starts out overlapping its own second segment (`SEGMENT_SPACING` = 10 units, far less than the fireball's own blast radius). Without both filters, fireballs either killed their shooter (head case) or were silently absorbed by their own body (body case, and since a snake with only a head has no body to hit, this bug only showed up once a snake had grown past one segment) (fixed 2026-07-27, see DECISIONS.md). Food: head overlap → `massGained`.
- **`food.ts`** — `generateSpawnFields`, `tickFood` (Brownian, `applyHeadVacuumPull`, optional head consume). Deterministic RNG (`random01`, xorshift32).
- **`gameLoop.ts`** — `tick`, `createEmptyWorld`, `applyMassLengthSync`, `MASS_PER_SEGMENT`, `IDLE_ABILITIES`.
- **`server.ts`** — `startServer`, WS sessions, `buildTickInputs`, `mergePlayerInput`, `buildSnapshot`, `selectFoodForSnapshot` (proximity-aware cap via `MAX_FOOD_IN_SNAPSHOT`).
- **`renderer.ts`** — `parseGameSnapshot`, `GameRenderer` (lerp between last two snaps, camera follows `followPlayerId`).
- **`public/client-entry.ts`** — WS wiring, WASD → direction, ability keys, `?debugFood=1` overlay.

### Gameplay constants (must match `docs/PRODUCT.md` — see §10 for the process that keeps them in sync)

| Constant | File | Value |
|---|---|---|
| `FIREBALL_MASS_FRACTION` | `abilities.ts` | 0.10 (10%) |
| `SHIELD_DRAIN_PER_SEC` | `abilities.ts` | 0.01 (1%/s) |
| `TURBO_DRAIN_PER_SEC` | `abilities.ts` | 0.10 (10%/s) |
| `BOOST_MASS_DRAIN_PER_SEC` | `abilities.ts` | 2 (flat mass/s) |
| `BOOST_SPEED_MUL` | `abilities.ts` | 1.5 (+50%) |
| `TURBO_SPEED_MUL` | `abilities.ts` | 3 (×3) |
| `DEFAULT_HEAD_TURN_RAD_PER_SEC` | `movement.ts` | 12 |
| `MASS_PER_SEGMENT` | `gameLoop.ts` | 10 |
| `FIREBALL_MAX_RANGE_PX` | `abilities.ts` | 900 |
| `FIREBALL_COOLDOWN_SEC` | `abilities.ts` | 5 |

*(As of 2026-07-27, these were just reconciled — code previously had fireball at 25% and shield at 5%/s, which contradicted PRODUCT.md; code was updated to match the spec. `FIREBALL_MAX_RANGE_PX` was added the same day as a new rule — see DECISIONS.md.)*

## 8. Networking wire shapes

**Welcome:** `{ "t": "welcome", "id": "p-1", "tickHz": 25, "bounds": {...} }`

**Snap** (every tick): `{ "t": "snap", "tick", "snakes": [{id, alive, head, dir, length, mass, visibleSegments}], "food": [{id, x, y, r}], "foodTotal", "fireballs": [{id, ownerId, x, y, r, sx, sy}] }`

- `sx, sy` — the fireball's spawn point. Added so the client can fade the
  projectile out as it nears `FIREBALL_MAX_RANGE_PX` without the server
  needing to send a life fraction every tick. Purely cosmetic on the client
  side — the server is what actually removes the fireball at max range.

**Input:** `{ "t": "input", "d": { "direction": {x, y}, "fire", "shield", "boost", "turbo" } }`

`foodTotal` can exceed `food.length` when the server caps food on the wire
(`MAX_FOOD_IN_SNAPSHOT`); nearby orbs are prioritized.

## 9. Known gaps vs PRODUCT.md

- **Minimap** — PRODUCT.md specs a minimap overlay (§World & camera); there is
  no minimap code in `renderer.ts` or anywhere else. Background/implementation
  notes from the original build plan are preserved at
  `plans/archive/minimap.exec.md`. Tracked as future work, not a current bug.

Keep this section current: when a PRODUCT.md rule has no implementation yet,
or an implementation detail has no PRODUCT.md rule, list it here so it isn't
silently forgotten (this is exactly the gap that caused the fireball/shield
drift fixed in §7).

## 10. Rules for agents working in this repo (how we keep PRODUCT.md and code from drifting again)

This project has already gone through one "code and spec quietly diverged"
cycle. To avoid a repeat:

1. **Gameplay numbers/rules live in PRODUCT.md, structure lives here.** If a
   task changes a number or rule that PRODUCT.md documents (mass costs, combat
   rules, food behavior, etc.), update PRODUCT.md *in the same task* — don't
   leave it for a later "reconciliation" pass.
2. **If you can't tell whether a requested change is a bug fix or an
   intentional retune, ask** instead of picking one silently. (This is what
   caused the fireball/shield drift — a real playtest change was made in code
   but the spec was never updated, and it went unnoticed for months.)
3. **Structural changes** (new module, changed tick order, changed World
   shape, new wire fields) → update this file (§3, §5, §6, §8) in the same
   task.
4. **Add or extend a test** near the module you touched (`tests/<system>.test.ts`).
   `tests/integration.test.ts` exercises multi-system behavior via `tick()`.
5. **Don't duplicate rules** across systems — e.g. boost eligibility is
   mirrored between movement preview and `tickAbilities`; if you change one,
   update the other or extract a shared helper.
6. **Client is dumb** — never trust it for mass, hits, or spawns; only intent.
7. **Rebuild the client bundle** (`npm run build:client`) if you touched
   `renderer.ts` or `public/client-entry.ts`.
8. Before closing out a task, do a quick pass: does anything in PRODUCT.md,
   §9 (Known gaps), or the constants table (§7) need updating because of what
   you just changed?

## 11. Further reading

| Doc | Contents |
|---|---|
| `AGENTS.md` (repo root) | Entry point for any agent — read this before this file |
| `docs/PRODUCT.md` | Gameplay rules, numbers, feel — current source of truth |
| `docs/DECISIONS.md` | Changelog of gameplay-number/rule changes and why |
| `docs/DEVELOPER_GUIDE.md` | Longer human-facing walkthrough + a worked example (improving fireball visibility) |
| `docs/archive/` | Superseded prototype-era design docs — history only |
| `plans/README.md` | Convention for what belongs in `plans/` going forward |
| `plans/archive/` | Superseded per-feature build plans — history only |
| `plans/bug_food_visibilty.md` | Active bug investigation (food visibility desync) |
