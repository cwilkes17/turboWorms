import type { Snake, Vec2 } from './snake'

export type { Snake, Vec2 }

export type FieldSize = 'small' | 'medium' | 'large'

/** Region where food spawns and Brownian drift is confined. */
export type SpawnField = {
  id: string
  center: Vec2
  /** Max distance from `center` food may occupy (orb center must stay inside this disc). */
  radius: number
  size: FieldSize
  /** Center-weighted fields spawn two orbs per spawn tick; orbs are slightly larger, same mass. */
  isCenterField: boolean
}

export type FoodOrbKind = 'normal' | 'doubleSize'

export type FoodOrb = {
  id: string
  fieldId: string
  position: Vec2
  velocity: Vec2
  radius: number
  mass: number
  kind: FoodOrbKind
}

export type WorldBounds = {
  center: Vec2
  /** Circular map radius used for field placement bias toward the middle. */
  radius: number
}

/**
 * Straight-line fireball projectile. Structurally matches `FireballProjectile` in `abilities.ts`
 * so arrays can be passed to collision/ability helpers without conversion.
 */
export type Fireball = {
  id: string
  ownerId: string
  position: Vec2
  velocity: Vec2
  radius: number
  /** Where this projectile spawned; used to expire it past `FIREBALL_MAX_RANGE_PX`. */
  spawnPosition?: Vec2
}

/**
 * Authoritative simulation snapshot: every mutable game value should be reachable from here
 * (no module-level sim globals). Keep this file types-only; systems read/write `World` fields.
 */
export type World = {
  /** Arena metadata used by spawn-field placement / density helpers. */
  bounds: WorldBounds

  /** Food spawn fields (layout is static for a match; orbs live in `food`). */
  spawnFields: SpawnField[]

  snakes: Snake[]
  food: FoodOrb[]
  fireballs: Fireball[]

  /**
   * Resource pool keyed by `snake.id` (`Snake` stays geometry + motion in `snake.ts`).
   * Aligns with `SnakeWithMass` pattern from abilities when composed at tick time.
   */
  snakeMassById: Record<string, number>

  /** Deterministic food PRNG state (mirrors `FoodSimState.rng` in `food.ts`). */
  foodRng: number
  /** Monotonic food-orb id counter (mirrors `FoodSimState.nextOrbId`). */
  foodNextOrbId: number
  /** Per-field spawn timers in seconds (mirrors `FoodSimState.spawnAccumSec`). */
  foodSpawnAccumSec: Record<string, number>

  /** Monotonic allocator for new fireball ids (abilities + collision consumers). */
  nextFireballId: number
  /** Monotonic allocator for collision/death-drop food ids. */
  nextFoodSpawnId: number

  /** Optional lockstep index for replay / net sync (advance in the sim driver, not here). */
  tick: number
}
