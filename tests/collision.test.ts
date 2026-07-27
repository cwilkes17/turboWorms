import assert from 'node:assert/strict'
import test from 'node:test'
import type { FireballProjectile } from '../abilities.ts'
import type { Snake } from '../contracts/snake'
import type { FoodOrb } from '../contracts/world'
import {
  DEFAULT_BODY_RADIUS,
  DEFAULT_COLLISION_CELL_SIZE,
  DEFAULT_HEAD_RADIUS,
  circlesOverlap,
  resolveCollisions,
} from '../collision.ts'

function worm(overrides: Partial<Snake> & Pick<Snake, 'id' | 'segments'>): Snake {
  return {
    direction: 0,
    speed: 1,
    alive: true,
    mass: 10,
    state: { shield: false, fireballCooldown: 0 },
    ...overrides,
  }
}

function fb(o: Omit<FireballProjectile, 'velocity'> & Partial<Pick<FireballProjectile, 'velocity'>>): FireballProjectile {
  return {
    velocity: { x: 1, y: 0 },
    ...o,
  }
}

function food(patch: Partial<FoodOrb> & Pick<FoodOrb, 'id' | 'position'>): FoodOrb {
  return {
    fieldId: 'test',
    velocity: { x: 0, y: 0 },
    radius: 2,
    mass: 1,
    kind: 'normal',
    ...patch,
  }
}

function opts() {
  return {
    cellSize: DEFAULT_COLLISION_CELL_SIZE,
    headRadius: DEFAULT_HEAD_RADIUS,
    bodyRadius: DEFAULT_BODY_RADIUS,
    nextFoodSpawnId: 1,
  }
}

test('circle helper sanity', () => {
  assert.equal(circlesOverlap(0, 0, 1, 2, 0, 1), true)
  assert.equal(circlesOverlap(0, 0, 1, 5, 0, 1), false)
})

test('fireball head overlap kills an enemy snake and removes projectile', () => {
  const snake = worm({
    id: 'snake-a',
    segments: [{ x: 10, y: 0 }],
  })
  const projectile = fb({
    id: 'fb-1',
    ownerId: 'enemy',
    position: { x: 10, y: 0 },
    radius: 5,
    velocity: { x: 0, y: 0 },
  })
  const out = resolveCollisions([snake], [projectile], [], opts())
  assert.equal(out.fireballs.length, 0)
  assert.equal(out.snakes[0].alive, false)
})

test('fireball never kills its own owner, even overlapping the owner head at spawn', () => {
  // Regression test: a fireball spawns at its owner's head position, so on the tick
  // it's created it can still overlap that same head (one tick of travel isn't enough
  // to clear the combined radii). It must not be lethal to its owner.
  const snake = worm({
    id: 'shooter',
    segments: [{ x: 10, y: 0 }],
  })
  const ownFireball = fb({
    id: 'fb-own',
    ownerId: 'shooter',
    position: { x: 10, y: 0 },
    radius: 5,
    velocity: { x: 40, y: 0 },
  })
  const out = resolveCollisions([snake], [ownFireball], [], opts())
  assert.equal(out.snakes[0].alive, true)
  assert.equal(out.fireballs.length, 1)
})

test('fireball passes through its own owner\'s body untouched', () => {
  // Regression test: fireballs spawn at the owner's head, so with any body segments
  // at all (SEGMENT_SPACING = 10 units apart) the projectile starts out overlapping
  // its own second segment. It must not be absorbed by its own body, or fireballs
  // would only ever work for a snake that's a single head with no body.
  const snake = worm({
    id: 'long-shooter',
    segments: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ],
  })
  const ownFireball = fb({
    id: 'fb-own-body',
    ownerId: 'long-shooter',
    position: { x: 0, y: 0 },
    radius: 5,
    velocity: { x: 40, y: 0 },
  })
  const out = resolveCollisions([snake], [ownFireball], [], opts())
  assert.equal(out.fireballs.length, 1)
  assert.equal(out.snakes[0].alive, true)
})

test('fireball body overlap removes projectile but leaves snake alive', () => {
  const snake = worm({
    id: 'long',
    segments: [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ],
  })
  const projectile = fb({
    id: 'fb-hit-body',
    ownerId: 'x',
    position: { x: 30, y: 0 },
    radius: 4,
  })
  const out = resolveCollisions([snake], [projectile], [], opts())
  assert.equal(out.fireballs.length, 0)
  assert.equal(out.snakes[0].alive, true)
})

test('head-to-head lethal for both snakes', () => {
  const a = worm({ id: 'a', segments: [{ x: 100, y: 0 }] })
  const b = worm({ id: 'b', segments: [{ x: 101, y: 0 }] })
  const out = resolveCollisions([a, b], [], [], {
    ...opts(),
    headRadius: 10,
    bodyRadius: DEFAULT_BODY_RADIUS,
  })
  assert.equal(out.snakes.find((s) => s.id === 'a')?.alive, false)
  assert.equal(out.snakes.find((s) => s.id === 'b')?.alive, false)
})

test('head-to-enemy-body kills attacker only', () => {
  const victim = worm({
    id: 'victim',
    segments: [
      { x: -100, y: 0 },
      { x: -12, y: 0 },
      { x: -150, y: 0 },
    ],
  })
  const attacker = worm({
    id: 'attacker',
    segments: [{ x: -4, y: 0 }],
  })

  const out = resolveCollisions([victim, attacker], [], [], {
    ...opts(),
    headRadius: 8,
    bodyRadius: 8,
  })

  assert.equal(out.snakes.find((s) => s.id === 'victim')?.alive, true)
  assert.equal(out.snakes.find((s) => s.id === 'attacker')?.alive, false)
})

test('self body overlap does not kill worm', () => {
  const s = worm({
    id: 'solo',
    segments: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 20 },
    ],
  })
  const out = resolveCollisions([s], [], [], opts())
  assert.equal(out.snakes[0].alive, true)
})

test('head collects nearest food deterministically when two heads overlap orb', () => {
  const a = worm({
    id: 'zebra',
    segments: [{ x: -10, y: 0 }],
  })
  const b = worm({
    id: 'alpha',
    segments: [{ x: 10, y: 0 }],
  })

  const orb = food({
    id: 'f-1',
    position: { x: 0, y: 0 },
    radius: 14,
    mass: 3,
  })

  const out = resolveCollisions([a, b], [], [orb], opts())
  assert.equal(out.foods.length, 0)
  assert.equal(out.massGained['alpha'], 3)
  assert.equal(out.massGained['zebra'], undefined)
})

test('distant snakes do not interact through the grid buckets', () => {
  const a = worm({
    id: 'far-west',
    segments: [{ x: -50_000, y: 0 }],
  })
  const b = worm({
    id: 'far-east',
    segments: [{ x: 60_000, y: 0 }],
  })

  const out = resolveCollisions([a, b], [], [], opts())
  assert.equal(out.snakes[0].alive, true)
  assert.equal(out.snakes[1].alive, true)
})

test('death spawns deterministic corpse food aligned to segment count', () => {
  const victim = worm({
    id: 'victim',
    segments: [
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: -10, y: 0 },
    ],
  })

  const projectile = fb({
    id: 'fb-1',
    ownerId: 'other',
    position: { x: 10, y: 0 },
    radius: 8,
    velocity: { x: 0, y: 0 },
  })

  const out = resolveCollisions([victim], [projectile], [], opts())

  assert.equal(out.snakes[0]?.alive, false)

  assert.equal(out.spawnedFoodFromDeaths.length, 3)

  assert.equal(out.spawnedFoodFromDeaths[0]?.fieldId, 'death-spawn')

  assert.equal(out.spawnedFoodFromDeaths[0]?.id, 'death-food-1')

  assert.equal(out.nextFoodSpawnId, 4)
})

test('deterministic replay yields identical payloads for isolated scenes', () => {
  const state = (): [Snake[], FireballProjectile[], FoodOrb[]] => {
    const snakes = [
      worm({
        id: 'first',
        segments: [{ x: 5_000, y: 5_000 }],
      }),
      worm({
        id: 'second',
        segments: [{ x: -4_800, y: -3_900 }],
      }),
    ]

    const foods = [
      food({
        id: 'orb-away',
        position: { x: 20_000, y: -10_500 },
      }),
      food({
        id: 'another-orb-away',
        position: { x: -33_333, y: 8_888 },
      }),
    ]

    return [snakes, [], foods]
  }

  const cfg = opts()
  const a = resolveCollisions(...state(), cfg)
  const b = resolveCollisions(...state(), cfg)

  assert.deepEqual(a.snakes.map((s) => s.alive), b.snakes.map((s) => s.alive))
  assert.deepEqual(a.snakes.flatMap((s) => s.segments), b.snakes.flatMap((s) => s.segments))
  assert.deepEqual(a.fireballs, b.fireballs)
  assert.deepEqual(a.massGained, b.massGained)
  assert.deepEqual(a.foods.map((o) => o.id).sort(), b.foods.map((o) => o.id).sort())
})
