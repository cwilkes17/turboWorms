import type { FireballProjectile } from './abilities'
import type { Snake, Vec2 } from './contracts/snake'
import type { FoodOrb } from './contracts/world'

export const DEFAULT_HEAD_RADIUS = 4
export const DEFAULT_BODY_RADIUS = 4

/** Uniform grid quantization; widen if custom radii can span multiple cells silently. */
export const DEFAULT_COLLISION_CELL_SIZE = 96

export type CollisionOptions = {
  cellSize?: number
  headRadius?: number
  bodyRadius?: number
  nextFoodSpawnId?: number
}

export type CollisionResult = {
  snakes: Snake[]
  fireballs: FireballProjectile[]
  foods: FoodOrb[]
  massGained: Record<string, number>
  /** Count of orbs consumed this tick per snake id (any kind, including corpse food) — the score. */
  foodEatenCount: Record<string, number>
  spawnedFoodFromDeaths: FoodOrb[]
  nextFoodSpawnId: number
}

type GridItem =
  | { kind: 'head'; snakeId: string; pos: Vec2; radius: number }
  | { kind: 'body'; snakeId: string; segmentIndex: number; pos: Vec2; radius: number }

type Buckets = Map<string, GridItem[]>

function key(ix: number, iy: number): string {
  return `${ix}:${iy}`
}

function cellCoords(x: number, y: number, cellSize: number): [number, number] {
  return [Math.floor(x / cellSize), Math.floor(y / cellSize)]
}

function hypot(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy)
}

export function circlesOverlap(ax: number, ay: number, ra: number, bx: number, by: number, rb: number): boolean {
  return hypot(ax - bx, ay - by) <= ra + rb + 1e-9
}

function sortSnakes(snakes: Snake[]): Snake[] {
  return [...snakes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function sortFoods(fs: FoodOrb[]): FoodOrb[] {
  return [...fs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function sortFbs(fs: FireballProjectile[]): FireballProjectile[] {
  return [...fs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function push(bucket: Buckets, ix: number, iy: number, item: GridItem): void {
  const k = key(ix, iy)
  const cur = bucket.get(k)
  if (cur) cur.push(item)
  else bucket.set(k, [item])
}

function get(bucket: Buckets, ix: number, iy: number): GridItem[] {
  return bucket.get(key(ix, iy)) ?? EMPTY
}

const EMPTY: GridItem[] = []

function neighbors(bucket: Buckets, pos: Vec2, cellSize: number): GridItem[] {
  const [cx, cy] = cellCoords(pos.x, pos.y, cellSize)
  const out: GridItem[] = []
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bs = get(bucket, cx + dx, cy + dy)
      if (bs.length) out.push(...bs)
    }
  }
  return out
}

function snakeAlive(s: Snake): boolean {
  return s.alive && s.segments.length > 0
}

function aliveIdSet(snakes: Snake[]): Set<string> {
  return new Set(snakes.filter(snakeAlive).map((s) => s.id))
}

function cloneSnake(s: Snake): Snake {
  return { ...s, segments: s.segments.map((p) => ({ x: p.x, y: p.y })) }
}

function buildBuckets(snakes: Snake[], cellSize: number, headR: number, bodyR: number): Buckets {
  const buckets: Buckets = new Map()
  for (const s of sortSnakes(snakes)) {
    if (!snakeAlive(s)) continue

    const h = s.segments[0]
    {
      const [ix, iy] = cellCoords(h.x, h.y, cellSize)
      push(buckets, ix, iy, { kind: 'head', snakeId: s.id, pos: h, radius: headR })
    }
    for (let j = 1; j < s.segments.length; j++) {
      const p = s.segments[j]
      const [ix, iy] = cellCoords(p.x, p.y, cellSize)
      push(buckets, ix, iy, {
        kind: 'body',
        snakeId: s.id,
        segmentIndex: j,
        pos: p,
        radius: bodyR,
      })
    }
  }
  return buckets
}

function cmpHead(h1: Extract<GridItem, { kind: 'head' }>, h2: typeof h1): number {
  return h1.snakeId < h2.snakeId ? -1 : h1.snakeId > h2.snakeId ? 1 : 0
}

function cmpBody(a: Extract<GridItem, { kind: 'body' }>, b: typeof a): number {
  if (a.snakeId !== b.snakeId) return a.snakeId < b.snakeId ? -1 : 1
  return a.segmentIndex - b.segmentIndex
}

function corpseFood(snake: Snake, startId: number): { drops: FoodOrb[]; next: number } {
  let cursor = startId
  const drops: FoodOrb[] = []
  for (const p of snake.segments) {
    drops.push({
      id: `death-food-${cursor}`,
      fieldId: 'death-spawn',
      position: { x: p.x, y: p.y },
      velocity: { x: 0, y: 0 },
      radius: 2,
      mass: 1,
      kind: 'normal',
    })
    cursor += 1
  }
  return { drops, next: cursor }
}

/** Deterministic collisions with uniform grid neighborhoods (bounded fan-out per entity). */

export function resolveCollisions(
  snakesIn: Snake[],
  fireballsIn: FireballProjectile[],
  foodsIn: FoodOrb[],
  options?: CollisionOptions
): CollisionResult {
  const cellSize = options?.cellSize ?? DEFAULT_COLLISION_CELL_SIZE
  const headR = options?.headRadius ?? DEFAULT_HEAD_RADIUS
  const bodyR = options?.bodyRadius ?? DEFAULT_BODY_RADIUS
  let nextFoodSpawnId = options?.nextFoodSpawnId ?? 1

  const snakes = snakesIn.map(cloneSnake)
  let fireballs = sortFbs(
    fireballsIn.map((fb) => ({ ...fb, position: { ...fb.position }, velocity: { ...fb.velocity } }))
  )
  let foods = sortFoods(foodsIn.map((f) => ({ ...f, position: { ...f.position }, velocity: { ...f.velocity } })))

  const aliveAtStart = new Map(snakes.map((s) => [s.id, s.alive]))
  const massGained: Record<string, number> = {}

  const fbRemove = new Set<string>()
  for (const fb of sortFbs(fireballs)) {
    if (fbRemove.has(fb.id)) continue

    const buckets = buildBuckets(snakes, cellSize, headR, bodyR)
    const cand = neighbors(buckets, fb.position, cellSize)

    let removed = false
    const heads = cand
      .filter((it): it is Extract<GridItem, { kind: 'head' }> => it.kind === 'head')
      .filter((h) => aliveIdSet(snakes).has(h.snakeId))
      /** Own fireball is never lethal to its owner (PRODUCT.md: "Fireball ↔ enemy head").
       *  Without this, a fireball spawned at the owner's head overlaps that same head on
       *  the very tick it's created (spawn position ≈ head position, one tick of travel
       *  isn't enough to clear the combined radii) and instantly kills the shooter. */
      .filter((h) => h.snakeId !== fb.ownerId)
      .sort(cmpHead)

    for (const h of heads) {
      const tgt = snakes.find((s) => s.id === h.snakeId)
      if (!tgt || !snakeAlive(tgt)) continue

      if (circlesOverlap(fb.position.x, fb.position.y, fb.radius, h.pos.x, h.pos.y, h.radius)) {
        if (tgt.state?.shield) {
          /**
           * Shield blocks the death, not the projectile: reflect the fireball off the
           * head-to-fireball normal instead of killing `tgt`. It stays lethal afterward
           * (PRODUCT.md) — just on a short travel budget from the bounce point
           * (FIREBALL_BOUNCE_RANGE_PX, applied in gameLoop's integrateFireballs) and
           * still immune to its own original owner (that filter already ran above).
           */
          const dx = fb.position.x - h.pos.x
          const dy = fb.position.y - h.pos.y
          const dist = hypot(dx, dy)
          const speed = hypot(fb.velocity.x, fb.velocity.y)
          const [nx, ny] =
            dist > 1e-6 ? [dx / dist, dy / dist] : speed > 1e-6 ? [-fb.velocity.x / speed, -fb.velocity.y / speed] : [1, 0]
          const dot = fb.velocity.x * nx + fb.velocity.y * ny
          fb.velocity = { x: fb.velocity.x - 2 * dot * nx, y: fb.velocity.y - 2 * dot * ny }
          /** Push just outside the shield's collision radius so the reflected fireball
           *  doesn't immediately re-overlap the same head and bounce again next tick
           *  before it's actually had a chance to move away. */
          fb.position = {
            x: h.pos.x + nx * (h.radius + fb.radius + 1),
            y: h.pos.y + ny * (h.radius + fb.radius + 1),
          }
          fb.bounced = true
          fb.spawnPosition = { x: fb.position.x, y: fb.position.y }
          removed = true
          break
        }

        tgt.alive = false
        fbRemove.add(fb.id)
        removed = true
        break
      }
    }

    if (!removed) {
      const bodies = cand
        .filter((it): it is Extract<GridItem, { kind: 'body' }> => it.kind === 'body')
        /** Same reasoning as the head filter above: a fireball spawns at its owner's
         *  head, so with any body segments at all it starts out only SEGMENT_SPACING
         *  (10 units) from its own second segment — far closer than the fireball's own
         *  blast radius. Without this filter every fireball fired by a snake longer
         *  than one segment was silently absorbed by its own body on the spawn tick,
         *  which is why fireballs only ever "worked" for a snake that was just a head. */
        .filter((b) => b.snakeId !== fb.ownerId)
        .sort(cmpBody)
      for (const b of bodies) {
        const owner = snakes.find((s) => s.id === b.snakeId)
        if (!owner || !snakeAlive(owner)) continue

        if (circlesOverlap(fb.position.x, fb.position.y, fb.radius, b.pos.x, b.pos.y, b.radius)) {
          fbRemove.add(fb.id)
          break
        }
      }
    }
  }

  fireballs = fireballs.filter((fb) => !fbRemove.has(fb.id))

  for (const attacker of sortSnakes(snakes)) {
    if (!snakeAlive(attacker)) continue
    const ah = attacker.segments[0]

    const buckets = buildBuckets(snakes, cellSize, headR, bodyR)
    const cand = neighbors(buckets, ah, cellSize)

    die: {
      const foeHeads = cand
        .filter((it): it is Extract<GridItem, { kind: 'head' }> => it.kind === 'head')
        .filter((h) => h.snakeId !== attacker.id && aliveIdSet(snakes).has(h.snakeId))
        .filter((h) => h.snakeId > attacker.id)
        .sort(cmpHead)

      for (const fh of foeHeads) {
        const other = snakes.find((s) => s.id === fh.snakeId)!
        if (!snakeAlive(other)) continue

        if (circlesOverlap(ah.x, ah.y, headR, fh.pos.x, fh.pos.y, fh.radius)) {
          attacker.alive = false
          other.alive = false
          break die
        }
      }

      const bodies = cand
        .filter((it): it is Extract<GridItem, { kind: 'body' }> => it.kind === 'body')
        .filter((b) => (b.snakeId === attacker.id ? true : aliveIdSet(snakes).has(b.snakeId)))
        .sort(cmpBody)

      for (const body of bodies) {
        if (body.snakeId === attacker.id) continue
        if (circlesOverlap(ah.x, ah.y, headR, body.pos.x, body.pos.y, body.radius)) {
          attacker.alive = false
          break
        }
      }
    }
  }

  /** Food pickups only for snakes still flagged alive */

  const consumedIds = new Set<string>()
  const foodEatenCount: Record<string, number> = {}
  for (const orb of foods) {
    const buckets = buildBuckets(snakes, cellSize, headR, bodyR)
    const headsNear = neighbors(buckets, orb.position, cellSize)
      .filter((it): it is Extract<GridItem, { kind: 'head' }> => it.kind === 'head')
      .filter((h) => aliveIdSet(snakes).has(h.snakeId))
      .sort(cmpHead)

    for (const h of headsNear) {
      const owner = snakes.find((s) => s.id === h.snakeId)!
      if (!snakeAlive(owner)) continue

      if (circlesOverlap(orb.position.x, orb.position.y, orb.radius, h.pos.x, h.pos.y, headR)) {
        massGained[h.snakeId] = (massGained[h.snakeId] ?? 0) + orb.mass
        /** Score = count of orbs consumed (any kind, including corpse food), not mass. */
        foodEatenCount[h.snakeId] = (foodEatenCount[h.snakeId] ?? 0) + 1
        consumedIds.add(orb.id)
        break
      }
    }
  }

  foods = foods.filter((o) => !consumedIds.has(o.id))

  const spawnedFoodFromDeaths: FoodOrb[] = []
  const freshDeadBodies = snakes
    .filter((s) => aliveAtStart.get(s.id) && !snakeAlive(s) && s.segments.length > 0)
    .sort((a, b) => (a.id < b.id ? -1 : 1))

  for (const corpse of freshDeadBodies) {
    const { drops, next } = corpseFood(corpse, nextFoodSpawnId)
    spawnedFoodFromDeaths.push(...drops)
    nextFoodSpawnId = next
  }

  return {
    snakes,
    fireballs,
    foods,
    massGained,
    foodEatenCount,
    spawnedFoodFromDeaths,
    nextFoodSpawnId,
  }
}
