import {
  type AbilityInput,
  BOOST_MASS_DRAIN_PER_SEC,
  BOOST_SPEED_MUL,
  FIREBALL_MAX_RANGE_PX,
  MASS_EPS,
  TURBO_SPEED_MUL,
  tickAbilities,
  type AbilityTickCtx,
} from './abilities.ts'
import type { Snake, Vec2 } from './contracts/snake'
import type { Fireball, FoodOrb, World } from './contracts/world'
import { DEFAULT_HEAD_EAT_RADIUS, type FoodSimState, tickFood } from './food.ts'
import { resolveCollisions, type CollisionOptions } from './collision.ts'
import {
  SEGMENT_SPACING,
  simulateMovement,
  steerHeadingToward,
  DEFAULT_HEAD_TURN_RAD_PER_SEC,
} from './movement.ts'

const DEFAULT_FLAT_PROJECTILE_SPEED = 250

/** Mass budget represented by segment count (integration: grow/shrink tail to match mass). */
export const MASS_PER_SEGMENT = 10

export const IDLE_ABILITIES: AbilityInput = {
  fireballTriggered: false,
  shieldHeld: false,
  boostHeld: false,
  turboHeld: false,
}

/** Per-snake player intent for one tick (`direction` optional = unchanged). */
export type SnakeTickInput = {
  direction?: number
  abilities: AbilityInput
}

/** Map `snake.id` → tick input; missing ids use idle abilities and keep facing. */
export type TickInputs = Record<string, SnakeTickInput>

export type GameTickOptions = {
  flatProjectileSpeed?: number
  segmentSpacing?: number
  collision?: CollisionOptions
  /** Angular cap steering head toward inputs (rad/s); default avoids WASD snapping into self-hit. */
  headTurnRadPerSec?: number
  /** Distance a fireball can travel from its spawn point before despawning (world units). */
  fireballMaxRangePx?: number
}

function cloneSnake(s: Snake): Snake {
  return {
    ...s,
    segments: s.segments.map((p) => ({ x: p.x, y: p.y })),
    state: { ...s.state },
  }
}

function cloneFood(o: FoodOrb): FoodOrb {
  return {
    ...o,
    position: { ...o.position },
    velocity: { ...o.velocity },
  }
}

function cloneFb(f: Fireball): Fireball {
  return {
    ...f,
    position: { ...f.position },
    velocity: { ...f.velocity },
    spawnPosition: f.spawnPosition ? { ...f.spawnPosition } : undefined,
  }
}

function cloneWorld(w: World): World {
  return {
    ...w,
    bounds: { ...w.bounds },
    spawnFields: w.spawnFields.map((f) => ({ ...f, center: { ...f.center } })),
    snakes: w.snakes.map(cloneSnake),
    food: w.food.map(cloneFood),
    fireballs: w.fireballs.map(cloneFb),
    snakeMassById: { ...w.snakeMassById },
    foodEatenById: { ...w.foodEatenById },
    snakeDrainPerSecById: { ...w.snakeDrainPerSecById },
    foodSpawnAccumSec: { ...w.foodSpawnAccumSec },
  }
}

function sortSnakes(by: Snake[]): Snake[] {
  return [...by].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function sortFoods(fs: FoodOrb[]): FoodOrb[] {
  return [...fs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function hypot(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy)
}

/** Target polyline nodes for current mass (at least head). */
export function targetSegmentCountForMass(mass: number): number {
  return Math.max(1, Math.floor(Math.max(0, mass) / MASS_PER_SEGMENT))
}

function tailAwayUnit(segments: Vec2[], fallbackDir: number): Vec2 {
  if (segments.length >= 2) {
    const tail = segments[segments.length - 1]!
    const prev = segments[segments.length - 2]!
    const dx = tail.x - prev.x
    const dy = tail.y - prev.y
    const len = hypot(dx, dy)
    if (len > 1e-9) return { x: dx / len, y: dy / len }
  }
  return { x: -Math.cos(fallbackDir), y: -Math.sin(fallbackDir) }
}

function growTail(segments: Vec2[], add: number, spacing: number, fallbackDir: number): Vec2[] {
  const out = segments.map((p) => ({ x: p.x, y: p.y }))
  for (let i = 0; i < add; i++) {
    const tail = out[out.length - 1]!
    const d = tailAwayUnit(out, fallbackDir)
    out.push({ x: tail.x + d.x * spacing, y: tail.y + d.y * spacing })
  }
  return out
}

/** After all mass changes for the tick, align `snake.mass` and segment count to `snakeMassById`. */
export function applyMassLengthSync(world: World, segmentSpacing: number): World {
  const snakes = sortSnakes(world.snakes).map((s) => {
    const mass = world.snakeMassById[s.id] ?? 0
    const target = targetSegmentCountForMass(mass)
    let segs = s.segments.map((p) => ({ x: p.x, y: p.y }))
    if (segs.length === 0) segs = [{ x: 0, y: 0 }]
    if (segs.length > target) segs = segs.slice(0, target)
    else if (segs.length < target) segs = growTail(segs, target - segs.length, segmentSpacing, s.direction)
    return { ...s, mass, segments: segs }
  })
  return { ...world, snakes }
}

/**
 * Boost/turbo speed for movement only — must mirror eligibility in `tickAbilities` (no drain here).
 * Stops as soon as `boostHeld` / `turboHeld` are false in `input`.
 */
function movementSpeedMultiplier(snake: Snake, mass: number, input: AbilityInput, dt: number): number {
  if (!snake.alive || mass <= MASS_EPS) return 1

  const turboDesired = snake.alive && mass > MASS_EPS && input.turboHeld
  const boostDesired =
    snake.alive &&
    mass + MASS_EPS >= BOOST_MASS_DRAIN_PER_SEC * dt &&
    input.boostHeld &&
    !input.turboHeld

  if (turboDesired) return TURBO_SPEED_MUL
  if (boostDesired) return BOOST_SPEED_MUL
  return 1
}

/** Moves projectiles, then drops any that have traveled past `maxRangePx` from spawn.
 *  A fireball with no `spawnPosition` (e.g. an older save or a hand-built test fixture)
 *  can't have its range measured, so it's left alone rather than guessed at. */
function integrateFireballs(fbs: Fireball[], dt: number, maxRangePx: number): Fireball[] {
  return fbs
    .map((fb) => ({
      ...fb,
      position: {
        x: fb.position.x + fb.velocity.x * dt,
        y: fb.position.y + fb.velocity.y * dt,
      },
    }))
    .filter((fb) => {
      if (!fb.spawnPosition) return true
      const dx = fb.position.x - fb.spawnPosition.x
      const dy = fb.position.y - fb.spawnPosition.y
      return hypot(dx, dy) < maxRangePx
    })
}

/** 1 — steer facing toward inputs (smooth turn prevents spine-overlap suicide on snapped WASD/network). */
function applyInputs(world: World, inputs: TickInputs, dt: number, headTurnOmega: number): World {
  const next = cloneWorld(world)
  next.snakes = next.snakes.map((s) => {
    const cmd = inputs[s.id]
    if (cmd?.direction === undefined) return s
    const nextDir = steerHeadingToward(s.direction, cmd.direction, dt, headTurnOmega)
    return { ...s, direction: nextDir }
  })
  return next
}

/** 2 — mirror held ability toggles onto snake state (no resource spend here). */
function updateAbilityHeldState(world: World, inputs: TickInputs): World {
  return {
    ...world,
    snakes: world.snakes.map((s) => {
      const cmd = inputs[s.id]?.abilities ?? IDLE_ABILITIES
      const mass = world.snakeMassById[s.id] ?? 0
      const shieldOn = s.alive && mass > MASS_EPS && cmd.shieldHeld
      return {
        ...s,
        state: { ...s.state, shield: shieldOn },
      }
    }),
  }
}

function mergeFoodSlices(w: World, state: FoodSimState): World {
  return {
    ...w,
    foodRng: state.rng,
    foodNextOrbId: state.nextOrbId,
    foodSpawnAccumSec: { ...state.spawnAccumSec },
    food: sortFoods(state.orbs.map(cloneFood)),
  }
}

/**
 * Fixed-step simulation entry (`plans/integration.exec.md` order).
 *
 * 1. apply inputs
 * 2. update ability states (toggle on/off from held flags)
 * 3. movement
 * 4. abilities (spawn fireballs, apply drains) — projectile spawn only; motion in step 4b
 * 4b. integrate fireballs
 * 5. collision (combat + food pickup → mass deltas on `resolveCollisions`)
 * 6. food fields / Brownian / spawns (`tickFood`, `consumeWithHeads: false`)
 * 7. growth/shrink tails from authoritative `snakeMassById`
 */

export function tick(world: World, inputs: TickInputs, deltaTime: number, options?: GameTickOptions): World {
  const dt = deltaTime
  const flatProjectileSpeed = options?.flatProjectileSpeed ?? DEFAULT_FLAT_PROJECTILE_SPEED
  const segmentSpacing = options?.segmentSpacing ?? SEGMENT_SPACING
  const headTurnOmega = options?.headTurnRadPerSec ?? DEFAULT_HEAD_TURN_RAD_PER_SEC
  const fireballMaxRangePx = options?.fireballMaxRangePx ?? FIREBALL_MAX_RANGE_PX

  let w = applyInputs(world, inputs, dt, headTurnOmega)

  /** 2 */
  w = updateAbilityHeldState(w, inputs)

  /** 3 */
  w = {
    ...w,
    snakes: sortSnakes(w.snakes).map((s) => {
      if (!s.alive || s.segments.length === 0) return s
      const cmd = inputs[s.id]?.abilities ?? IDLE_ABILITIES
      const mass = w.snakeMassById[s.id] ?? 0
      const mult = movementSpeedMultiplier(s, mass, cmd, dt)
      const intrinsic = s.speed
      const moved = simulateMovement({ ...s, speed: intrinsic * mult }, dt, segmentSpacing)
      /** Do not persist boost/turbo into `Snake.speed` — boost stops when input releases. */
      return { ...moved, speed: intrinsic }
    }),
  }

  /** 4 */
  let massById = { ...w.snakeMassById }
  let nextFbId = w.nextFireballId
  let fireballs = w.fireballs.map(cloneFb)
  const snakesById = new Map(sortSnakes(w.snakes).map((s) => [s.id, s]))
  /** Instantaneous, not cumulative — fully replaced each tick (see World.snakeDrainPerSecById). */
  const drainById: Record<string, number> = {}

  for (const snake of sortSnakes(w.snakes)) {
    if (!snake.alive) continue

    const cmd = inputs[snake.id]?.abilities ?? IDLE_ABILITIES
    const ctx: AbilityTickCtx = {
      intrinsicSpeed: snake.speed,
      flatProjectileSpeed,
      nextFireballId: nextFbId,
    }

    const composedMass = massById[snake.id] ?? 0
    const payload = tickAbilities(
      {
        ...snake,
        mass: composedMass,
      },
      cmd,
      dt,
      ctx
    )

    nextFbId = payload.nextFireballId
    drainById[snake.id] = payload.drainPerSec

    for (const spawned of payload.fireballsSpawned) {
      fireballs.push({
        id: spawned.id,
        ownerId: spawned.ownerId,
        position: { ...spawned.position },
        velocity: { ...spawned.velocity },
        radius: spawned.radius,
        spawnPosition: { ...(spawned.spawnPosition ?? spawned.position) },
      })
    }

    const { mass: nextMass, ...restFromAbility } = payload.snake
    massById[snake.id] = nextMass
    snakesById.set(snake.id, { ...restFromAbility, mass: nextMass })
  }

  w = {
    ...w,
    snakes: sortSnakes([...snakesById.values()]),
    snakeMassById: massById,
    snakeDrainPerSecById: drainById,
    nextFireballId: nextFbId,
    fireballs,
  }

  /** 4b */
  w = {
    ...w,
    fireballs: integrateFireballs(w.fireballs, dt, fireballMaxRangePx),
  }

  /** 5 — includes head vs food pickups → `massGained` */

  const hit = resolveCollisions(w.snakes, w.fireballs, w.food, {
    ...options?.collision,
    nextFoodSpawnId: w.nextFoodSpawnId,
  })

  const mergedMass: Record<string, number> = { ...w.snakeMassById }
  for (const [id, gain] of Object.entries(hit.massGained)) {
    mergedMass[id] = (mergedMass[id] ?? 0) + gain
  }

  /** Cumulative, unlike snakeDrainPerSecById — score only ever goes up. */
  const mergedFoodEaten: Record<string, number> = { ...w.foodEatenById }
  for (const [id, count] of Object.entries(hit.foodEatenCount)) {
    mergedFoodEaten[id] = (mergedFoodEaten[id] ?? 0) + count
  }

  const mergedFood = sortFoods([...hit.foods.map(cloneFood), ...hit.spawnedFoodFromDeaths.map(cloneFood)])

  w = {
    ...w,
    snakes: hit.snakes.map(cloneSnake),
    fireballs: hit.fireballs.map(cloneFb),
    food: mergedFood,
    snakeMassById: mergedMass,
    foodEatenById: mergedFoodEaten,
    nextFoodSpawnId: hit.nextFoodSpawnId,
  }

  /** 6 */
  const foodCore: FoodSimState = {
    rng: w.foodRng,
    orbs: w.food,
    nextOrbId: w.foodNextOrbId,
    spawnAccumSec: { ...w.foodSpawnAccumSec },
  }

  const foodPass = tickFood(foodCore, w.spawnFields, w.snakes, dt, DEFAULT_HEAD_EAT_RADIUS, {
    consumeWithHeads: false,
  })

  w = mergeFoodSlices(w, foodPass.state)

  /** 7 */
  w = applyMassLengthSync(w, segmentSpacing)

  return {
    ...w,
    tick: w.tick + 1,
  }
}

/** Helper for tests / generators — not required for `tick`, but convenient. */

export function createEmptyWorld(overrides: Partial<World> & Pick<World, 'bounds'>): World {
  const base: World = {
    bounds: overrides.bounds,
    spawnFields: overrides.spawnFields ?? [],
    snakes: overrides.snakes ?? [],
    food: overrides.food ?? [],
    fireballs: overrides.fireballs ?? [],
    snakeMassById: overrides.snakeMassById ?? {},
    foodEatenById: overrides.foodEatenById ?? {},
    snakeDrainPerSecById: overrides.snakeDrainPerSecById ?? {},
    foodRng: overrides.foodRng ?? 0x9e3779b1,
    foodNextOrbId: overrides.foodNextOrbId ?? 1,
    foodSpawnAccumSec: overrides.foodSpawnAccumSec ?? {},
    nextFireballId: overrides.nextFireballId ?? 1,
    nextFoodSpawnId: overrides.nextFoodSpawnId ?? 1,
    tick: overrides.tick ?? 0,
  }
  return base
}
