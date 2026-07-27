import type { Snake, Vec2 } from './contracts/snake'
import type {
  FoodOrb,
  FoodOrbKind,
  SpawnField,
  WorldBounds,
} from './contracts/world'

export const SPAWN_SECONDS_PER_ORB = 3
export const FOOD_NORMAL_RADIUS = 2
export const FOOD_DOUBLE_RADIUS = 3
export const DEFAULT_HEAD_EAT_RADIUS = 4

/** Max food speed magnitude after Brownian perturbation + clamp (units/sec). */
export const MAX_FOOD_SPEED = 45

/** Orbs within this radius of a snake head are pulled toward it (world units). */
export const HEAD_VACUUM_RANGE = 100

/** Peak additional speed toward the head at the edge of the vacuum (scales to 0 at `HEAD_VACUUM_RANGE`). */
export const HEAD_VACUUM_PULL_SPEED = 400

/** Δv coefficient per axis before multiplication by dt (Brownian perturbation strength). */
export const BROWNIAN_DV = 18

/** Field disc radii by designer size category. */
export const FIELD_DISC_RADIUS: Record<SpawnField['size'], number> = {
  small: 60,
  medium: 150,
  large: 300,
}

/** Fields whose center lies within this fraction of world radius are "center" fields (double spawn). */
export const CENTER_FIELD_FRACTION = 0.28

export type FoodSimState = {
  /** xorshift32 state; must not be 0. */
  rng: number
  orbs: FoodOrb[]
  nextOrbId: number
  /** Banked time (seconds) toward the next spawn per field. */
  spawnAccumSec: Record<string, number>
}

export function createFoodSimState(initialRng: number): FoodSimState {
  const s = initialRng >>> 0
  return {
    rng: s === 0 ? 0x9e3779b1 : s,
    orbs: [],
    nextOrbId: 1,
    spawnAccumSec: {},
  }
}

/** Returns [0, 1) and next rng state (xorshift32; zero state repaired). */
export function random01(rng: number): [number, number] {
  let x = rng >>> 0
  if (x === 0) x = 0x9e3779b9
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  let next = x >>> 0
  if (next === 0) next = 0xbeef59d1
  return [next / 4294967296, next]
}

function hypot(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy)
}

/** Sample radius in [0, R] with density ∝ (1 − r/R) (more fields near center). */
export function sampleRadiusTowardCenter(rand01: number, worldRadius: number): number {
  const u = Math.min(1, Math.max(0, rand01))
  const t = 1 - Math.sqrt(1 - u)
  return t * worldRadius
}

/** Uniform random point inside a circle of radius `discRadius` around `center`. */
export function samplePointInDisc(
  center: Vec2,
  discRadius: number,
  uR: number,
  uTheta: number
): Vec2 {
  const r = discRadius * Math.sqrt(Math.min(1, Math.max(0, uR)))
  const th = uTheta * (Math.PI * 2)
  return { x: center.x + r * Math.cos(th), y: center.y + r * Math.sin(th) }
}

function fieldSizeFromU(u: number): SpawnField['size'] {
  if (u < 1 / 3) return 'small'
  if (u < 2 / 3) return 'medium'
  return 'large'
}

/** Deterministic pseudo-random placement: more fields nearer world center (linear radial density). */
export function generateSpawnFields(
  bounds: WorldBounds,
  fieldCount: number,
  rngSeed: number
): { fields: SpawnField[]; rng: number } {
  let rng = rngSeed >>> 0
  if (rng === 0) rng = 0xdea2cb91

  const fields: SpawnField[] = []

  for (let i = 0; i < fieldCount; i++) {
    let u1 = 0
    ;[u1, rng] = random01(rng)
    let u2 = 0
    ;[u2, rng] = random01(rng)
    let u3 = 0
    ;[u3, rng] = random01(rng)

    const r = sampleRadiusTowardCenter(u1, bounds.radius)
    const ang = u2 * (Math.PI * 2)
    const center: Vec2 = {
      x: bounds.center.x + r * Math.cos(ang),
      y: bounds.center.y + r * Math.sin(ang),
    }

    const size = fieldSizeFromU(u3)
    const disc = FIELD_DISC_RADIUS[size]

    const dCenter = hypot(center.x - bounds.center.x, center.y - bounds.center.y)
    const isCenterField = dCenter <= bounds.radius * CENTER_FIELD_FRACTION + 1e-6

    fields.push({
      id: `field-${i}`,
      center,
      radius: disc,
      size,
      isCenterField,
    })
  }

  return { fields, rng }
}

function sortIds<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function containInField(orb: FoodOrb, field: SpawnField): FoodOrb {
  const dx = orb.position.x - field.center.x
  const dy = orb.position.y - field.center.y
  const d = hypot(dx, dy)
  const maxD = Math.max(0, field.radius - orb.radius)
  if (d <= maxD || maxD === 0) return orb

  const nx = dx / (d === 0 ? 1 : d)
  const ny = dy / (d === 0 ? 0 : d)
  const px = field.center.x + nx * maxD
  const py = field.center.y + ny * maxD

  // Reflect outward velocity component (bounce off circular boundary).
  const vn = orb.velocity.x * nx + orb.velocity.y * ny
  let vx = orb.velocity.x
  let vy = orb.velocity.y
  if (vn > 0) {
    vx -= 2 * vn * nx
    vy -= 2 * vn * ny
  }

  return {
    ...orb,
    position: { x: px, y: py },
    velocity: { x: vx, y: vy },
  }
}

function clampSpeed(vx: number, vy: number, max: number): { x: number; y: number } {
  const s = hypot(vx, vy)
  if (s <= max || s === 0) return { x: vx, y: vy }
  const k = max / s
  return { x: vx * k, y: vy * k }
}

/**
 * Bias each orb toward the nearest alive snake head (deterministic tie-break on id).
 * Feels like a light vacuum / hover pull; runs after Brownian, before field containment.
 */
export function applyHeadVacuumPull(orb: FoodOrb, snakes: Snake[], dt: number): FoodOrb {
  type Cand = { d2: number; id: string; nx: number; ny: number }
  const cands: Cand[] = []
  for (const s of sortIds(snakes)) {
    if (!s.alive || !s.segments[0]) continue
    const h = s.segments[0]!
    const dx = h.x - orb.position.x
    const dy = h.y - orb.position.y
    const d2 = dx * dx + dy * dy
    if (d2 < 1e-12) continue
    const d = Math.sqrt(d2)
    cands.push({ d2, id: s.id, nx: dx / d, ny: dy / d })
  }
  if (!cands.length) return orb
  cands.sort((a, b) => (a.d2 !== b.d2 ? a.d2 - b.d2 : a.id.localeCompare(b.id)))
  const c = cands[0]!
  const range = HEAD_VACUUM_RANGE
  if (c.d2 > range * range) return orb
  const dist = Math.sqrt(c.d2)
  const t = 1 - dist / range
  const falloff = t * t
  const slip = HEAD_VACUUM_PULL_SPEED * falloff * dt
  let vx = orb.velocity.x + c.nx * slip * 2.5
  let vy = orb.velocity.y + c.ny * slip * 2.5
  const v = clampSpeed(vx, vy, MAX_FOOD_SPEED)
  return {
    ...orb,
    velocity: { x: v.x, y: v.y },
    position: {
      x: orb.position.x + c.nx * slip,
      y: orb.position.y + c.ny * slip,
    },
  }
}

function advanceBrownian(orb: FoodOrb, field: SpawnField, dt: number, rngIn: number): [FoodOrb, number] {
  let rng = rngIn
  let ax = 0
  ;[ax, rng] = random01(rng)
  let ay = 0
  ;[ay, rng] = random01(rng)

  let dvx = (ax * 2 - 1) * BROWNIAN_DV
  let dvy = (ay * 2 - 1) * BROWNIAN_DV

  let vx = orb.velocity.x + dvx * dt
  let vy = orb.velocity.y + dvy * dt
  const v = clampSpeed(vx, vy, MAX_FOOD_SPEED)
  vx = v.x
  vy = v.y

  let x = orb.position.x + vx * dt
  let y = orb.position.y + vy * dt
  let next: FoodOrb = { ...orb, velocity: { x: vx, y: vy }, position: { x, y } }
  next = containInField(next, field)
  return [next, rng]
}

function spawnOrb(params: {
  field: SpawnField
  nextOrbId: number
  rng: number
  kind: FoodOrbKind
}): { orb: FoodOrb; rng: number; nextOrbId: number } {
  let { rng, field, nextOrbId, kind } = params
  let uR = 0
  ;[uR, rng] = random01(rng)
  let uTh = 0
  ;[uTh, rng] = random01(rng)

  const radius = kind === 'doubleSize' ? FOOD_DOUBLE_RADIUS : FOOD_NORMAL_RADIUS
  const pos = samplePointInDisc(field.center, Math.max(0, field.radius - radius), uR, uTh)

  const orb: FoodOrb = {
    id: `food-${nextOrbId}`,
    fieldId: field.id,
    position: pos,
    velocity: { x: 0, y: 0 },
    radius,
    mass: 1,
    kind,
  }
  return { orb, rng, nextOrbId: nextOrbId + 1 }
}

export type FoodTickResult = {
  state: FoodSimState
  massGained: Record<string, number>
}

/**
 * One simulation step: Brownian motion (contained per field), spawn from fields (~1 per 3s each),
 * then consumption by snake heads. Deterministic given `state`, `fields`, snakes, dt, constants.
 */
export type TickFoodOptions = {
  /**
   * When false, skip head-vs-food consumption (Brownian + spawn still run).
   * Use when another system (e.g. collision) already resolved pickups this tick.
   */
  consumeWithHeads?: boolean
}

export function tickFood(
  stateIn: FoodSimState,
  fields: SpawnField[],
  snakes: Snake[],
  dt: number,
  headRadius: number = DEFAULT_HEAD_EAT_RADIUS,
  options?: TickFoodOptions
): FoodTickResult {
  const consumeWithHeads = options?.consumeWithHeads !== false
  let rng = stateIn.rng
  let nextOrbId = stateIn.nextOrbId

  const fieldMap = new Map<string, SpawnField>()
  for (const f of fields) fieldMap.set(f.id, f)

  let orbs = stateIn.orbs.map((o) => ({ ...o, position: { ...o.position }, velocity: { ...o.velocity } }))

  const aliveForVacuum = sortIds(snakes.filter((s) => s.alive && s.segments.length > 0))

  const brownian: FoodOrb[] = []
  for (const orb of sortIds(orbs)) {
    const field = fieldMap.get(orb.fieldId)
    if (!field) continue
    const [updated, r] = advanceBrownian(orb, field, dt, rng)
    rng = r
    const pulled = applyHeadVacuumPull(updated, aliveForVacuum, dt)
    brownian.push(containInField(pulled, field))
  }
  orbs = brownian

  const spawnAccum = { ...stateIn.spawnAccumSec }
  const newSpawns: FoodOrb[] = []

  for (const field of sortIds(fields)) {
    let acc = spawnAccum[field.id] ?? 0
    acc += dt
    while (acc >= SPAWN_SECONDS_PER_ORB - 1e-9) {
      acc -= SPAWN_SECONDS_PER_ORB
      const spawnsPerTick = field.isCenterField ? 2 : 1
      for (let k = 0; k < spawnsPerTick; k++) {
        const kind: FoodOrbKind = field.isCenterField ? 'doubleSize' : 'normal'
        const out = spawnOrb({ field, nextOrbId, rng, kind })
        rng = out.rng
        nextOrbId = out.nextOrbId
        newSpawns.push(out.orb)
      }
    }
    spawnAccum[field.id] = acc
  }

  orbs = sortIds([...orbs, ...newSpawns])

  if (!consumeWithHeads) {
    const state: FoodSimState = {
      rng,
      orbs,
      nextOrbId,
      spawnAccumSec: spawnAccum,
    }
    return { state, massGained: {} }
  }

  const massGained: Record<string, number> = {}
  const aliveSnakes = sortIds(snakes.filter((s) => s.alive && s.segments.length > 0))
  const remaining: FoodOrb[] = []

  for (const orb of orbs) {
    const head = (() => {
      for (const snake of aliveSnakes) {
        const h = snake.segments[0]
        const dx = h.x - orb.position.x
        const dy = h.y - orb.position.y
        if (hypot(dx, dy) <= headRadius + orb.radius) return snake
      }
      return null
    })()

    if (head) {
      massGained[head.id] = (massGained[head.id] ?? 0) + orb.mass
    } else {
      remaining.push(orb)
    }
  }

  const state: FoodSimState = {
    rng,
    orbs: remaining,
    nextOrbId,
    spawnAccumSec: spawnAccum,
  }

  return { state, massGained }
}
