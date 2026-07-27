import type { Snake, Vec2 } from './contracts/snake'

export const FIREBALL_MASS_FRACTION = 0.2

/** Shield: 1% of current mass per second (applied after any fireball cost). */
export const SHIELD_DRAIN_PER_SEC = 0.01

/** Turbo: 10% of current mass per second (after shield drain for that tick). */
export const TURBO_DRAIN_PER_SEC = 0.1

/** Constant mass drain rate while boost holds (equiv. “2 food orbs/sec” vs game design orb mass 1). */
export const BOOST_MASS_DRAIN_PER_SEC = 2

/** +50% forward speed multiplier while boost applies. */
export const BOOST_SPEED_MUL = 1.5

/** +200% forward speed ⇒ ×3 intrinsic speed while turbo applies. */
export const TURBO_SPEED_MUL = 3

export const MASS_EPS = 1e-9

/**
 * Fireball despawns after traveling this far from where it spawned (world units,
 * same space as segment positions). Chosen as roughly half a screen-width at
 * default zoom (~900-1000 units visible) so it has real range but can't cross
 * the map (bounds.radius is typically 6000, i.e. a 12000-unit diameter — this
 * is ~7.5% of that). See docs/DECISIONS.md.
 */
export const FIREBALL_MAX_RANGE_PX = 900

/**
 * After bouncing off a shield, a fireball gets this much travel budget instead of
 * FIREBALL_MAX_RANGE_PX, measured fresh from the bounce point (PRODUCT.md: "despawns a
 * short distance after the bounce"). ~1/5 of the normal range — enough to actually threaten
 * something nearby, short enough to clearly read as "spent" rather than a second full shot.
 * See docs/DECISIONS.md.
 */
export const FIREBALL_BOUNCE_RANGE_PX = 180

/** Seconds that must pass after a successful fire before another is allowed (PRODUCT.md). */
export const FIREBALL_COOLDOWN_SEC = 5

export type SnakeWithMass = Snake & { mass: number }

export type AbilityInput = {
  /** Edge-trigger once per simulation step if the player tapped fireball. */
  fireballTriggered: boolean
  shieldHeld: boolean
  boostHeld: boolean
  turboHeld: boolean
}

export type FireballProjectile = {
  id: string
  ownerId: string
  position: Vec2
  velocity: Vec2
  /** Matches head radius scaled from mass before fireball resolves. */
  radius: number
  /** Where this projectile spawned (or last bounced from); used to measure travel distance
   *  for range expiry. Optional so hand-built test fixtures without it still type-check —
   *  gameLoop treats a missing spawnPosition as "can't determine range, never expire". */
  spawnPosition?: Vec2
  /** Set once it has bounced off a shield. Still lethal to enemies (never its original
   *  owner) — just on a shorter travel budget (FIREBALL_BOUNCE_RANGE_PX) and visually
   *  fading to black. See docs/PRODUCT.md's Shield section. */
  bounced?: boolean
}

export type AbilityTickCtx = {
  /** Linear speed used by movement when no boost is active (intrinsic worm speed scalar). */
  intrinsicSpeed: number
  flatProjectileSpeed: number
  /** Monotonic counter for spawned projectile ids (`fb-${nextFireballId}` then increment). */
  nextFireballId: number
}

export type AbilityTickResult = {
  snake: SnakeWithMass
  shieldActive: boolean
  effectiveSpeed: number
  fireballsSpawned: FireballProjectile[]
  /** Pass through to next tick unchanged if no projectile spawned */
  nextFireballId: number
  /**
   * Mass/sec currently being spent on held abilities (shield + turbo/boost) — for HUD
   * display. Deliberately excludes the one-time fireball cost, which is a burst spend,
   * not an ongoing "drain" in the sense a live rate readout implies.
   */
  drainPerSec: number
}

/** Head radius scales with sqrt(mass) with a small floor. */
export function headRadiusFromMass(mass: number): number {
  return 4 + Math.sqrt(Math.max(mass, 0)) * 3
}

function clampNonNegativeMass(m: number): number {
  return m <= 0 ? 0 : m
}

/**
 * Applies resource costs and ability effects for one tick.
 *
 * Order (deterministic): fireball 20% (if triggered and off cooldown) → shield 1%/s of
 * current mass → turbo 10%/s or boost 2/s mass (turbo suppresses boost) → clamp mass.
 *
 * `Snake.speed` is not modified; use `effectiveSpeed` with `ctx.intrinsicSpeed` as the worm baseline.
 */
export function tickAbilities(
  snake: SnakeWithMass,
  input: AbilityInput,
  dt: number,
  ctx: AbilityTickCtx
): AbilityTickResult {
  let mass = snake.mass
  const fireballsSpawned: FireballProjectile[] = []
  let nextFireballId = ctx.nextFireballId

  /**
   * `fireballTriggered` reflects whatever the client last sent — which is `true` for the
   * entire time the key is held (~45Hz), not just the initial press. A cooldown gate (not
   * just an alive/mass check) is what makes holding the key equivalent to tapping it
   * exactly on cadence, instead of firing every single tick and instantly draining mass.
   */
  let fireballCooldown = Math.max(0, (snake.state?.fireballCooldown ?? 0) - dt)

  if (input.fireballTriggered && snake.alive && mass > MASS_EPS && fireballCooldown <= MASS_EPS) {
    const radius = headRadiusFromMass(mass)
    const head = snake.segments[0] ?? { x: 0, y: 0 }
    const spd = ctx.flatProjectileSpeed
    const vx = Math.cos(snake.direction) * spd
    const vy = Math.sin(snake.direction) * spd
    fireballsSpawned.push({
      id: `fb-${nextFireballId}`,
      ownerId: snake.id,
      position: { x: head.x, y: head.y },
      velocity: { x: vx, y: vy },
      radius,
      spawnPosition: { x: head.x, y: head.y },
    })
    nextFireballId += 1
    mass = clampNonNegativeMass(mass * (1 - FIREBALL_MASS_FRACTION))
    fireballCooldown = FIREBALL_COOLDOWN_SEC
  }

  const alive = snake.alive
  /** Mass/sec from held abilities only — the one-time fireball cost above is not a "drain". */
  let drainPerSec = 0

  if (alive && mass > MASS_EPS && input.shieldHeld) {
    const shieldRate = mass * SHIELD_DRAIN_PER_SEC
    mass -= shieldRate * dt
    drainPerSec += shieldRate
  }
  mass = clampNonNegativeMass(mass)

  const turboDesired = alive && mass > MASS_EPS && input.turboHeld
  const boostDesired =
    alive &&
    mass + MASS_EPS >= BOOST_MASS_DRAIN_PER_SEC * dt &&
    input.boostHeld &&
    !input.turboHeld

  let speedMul = 1
  if (turboDesired) {
    const turboRate = mass * TURBO_DRAIN_PER_SEC
    mass -= turboRate * dt
    drainPerSec += turboRate
    speedMul = TURBO_SPEED_MUL
  } else if (boostDesired) {
    mass -= BOOST_MASS_DRAIN_PER_SEC * dt
    drainPerSec += BOOST_MASS_DRAIN_PER_SEC
    speedMul = BOOST_SPEED_MUL
  }

  mass = clampNonNegativeMass(mass)

  const shieldActive = input.shieldHeld && snake.alive && mass > MASS_EPS

  return {
    /** `state.shield` reflects this tick's authoritative `shieldActive` (post mass-check),
     *  not just the raw held flag — so a renderer or future collision check reading
     *  `Snake.state.shield` sees whether the shield can actually still afford to be up. */
    snake: { ...snake, mass, state: { ...snake.state, fireballCooldown, shield: shieldActive } },
    shieldActive,
    effectiveSpeed: ctx.intrinsicSpeed * speedMul,
    fireballsSpawned,
    nextFireballId,
    drainPerSec,
  }
}
