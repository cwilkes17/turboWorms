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

test('fireball bounces off a shielded head instead of killing it', () => {
  const shielded = worm({
    id: 'guardian',
    segments: [{ x: 100, y: 0 }],
    state: { shield: true, fireballCooldown: 0 },
  })
  const projectile = fb({
    id: 'fb-bounce',
    ownerId: 'attacker',
    position: { x: 90, y: 0 },
    radius: 5,
    velocity: { x: 50, y: 0 },
  })
  const out = resolveCollisions([shielded], [projectile], [], { ...opts(), headRadius: 8, bodyRadius: 8 })

  assert.equal(out.snakes[0].alive, true, 'shield blocks the death')
  assert.equal(out.fireballs.length, 1, 'fireball is not removed - it bounces')
  const bounced = out.fireballs[0]!
  assert.equal(bounced.bounced, true)
  assert.ok(Math.abs(bounced.velocity.x - -50) < 1e-9, 'head-on hit reflects straight back')
  assert.ok(Math.abs(bounced.velocity.y) < 1e-9)
  const distFromHead = Math.hypot(bounced.position.x - 100, bounced.position.y)
  assert.ok(distFromHead >= 8 + 5, 'pushed just outside the shield so it will not re-bounce next tick')
  assert.deepEqual(bounced.spawnPosition, bounced.position, 'range budget resets fresh from the bounce point')
})

test('a bounced fireball is still lethal to the next enemy head it touches', () => {
  const shielded = worm({
    id: 'guardian',
    segments: [{ x: 100, y: 0 }],
    state: { shield: true, fireballCooldown: 0 },
  })
  const projectile = fb({
    id: 'fb-1',
    ownerId: 'attacker',
    position: { x: 90, y: 0 },
    radius: 5,
    velocity: { x: 50, y: 0 },
  })
  const opt = { ...opts(), headRadius: 8, bodyRadius: 8 }
  const afterBounce = resolveCollisions([shielded], [projectile], [], opt)
  const bouncedFb = afterBounce.fireballs[0]!
  assert.equal(bouncedFb.bounced, true)

  const victim = worm({ id: 'bystander', segments: [{ x: bouncedFb.position.x, y: bouncedFb.position.y }] })
  const secondHit = resolveCollisions([victim], [bouncedFb], [], opt)
  assert.equal(secondHit.snakes[0].alive, false, 'bounced fireball is still deadly')
  assert.equal(secondHit.fireballs.length, 0, 'consumed on the lethal hit, same as any other fireball')
})

test('a fresh (not yet bounced) fireball still cannot harm its own original owner', () => {
  // Owner-immunity still applies before any bounce - only firing at a shielded target
  // opens up the risk. An unbounced fireball flying back toward its own shooter (e.g. a
  // stray shot that curves back is not possible here, but a shooter moving into their own
  // slow-traveling shot is) must stay harmless.
  const shooter = worm({ id: 'shooter', segments: [{ x: 10, y: 0 }] })
  const ownFireball = fb({
    id: 'fb-1',
    ownerId: 'shooter',
    position: { x: 10, y: 0 },
    radius: 5,
    velocity: { x: 40, y: 0 },
  })
  const out = resolveCollisions([shooter], [ownFireball], [], opts())
  assert.equal(out.snakes[0].alive, true)
  assert.equal(out.fireballs.length, 1)
})

test('a bounced fireball IS lethal to its own original owner - firing at a shield carries risk', () => {
  const shielded = worm({
    id: 'guardian',
    segments: [{ x: 100, y: 0 }],
    state: { shield: true, fireballCooldown: 0 },
  })
  const projectile = fb({
    id: 'fb-1',
    ownerId: 'shooter',
    position: { x: 90, y: 0 },
    radius: 5,
    velocity: { x: 50, y: 0 },
  })
  const opt = { ...opts(), headRadius: 8, bodyRadius: 8 }
  const afterBounce = resolveCollisions([shielded], [projectile], [], opt)
  const bouncedFb = afterBounce.fireballs[0]!
  assert.equal(bouncedFb.bounced, true)

  const owner = worm({ id: 'shooter', segments: [{ x: bouncedFb.position.x, y: bouncedFb.position.y }] })
  const secondHit = resolveCollisions([owner], [bouncedFb], [], opt)
  assert.equal(secondHit.snakes[0].alive, false, 'the shooter is not immune once their own shot has bounced')
  assert.equal(secondHit.fireballs.length, 0, 'consumed on the lethal hit')
})

test('a bounced fireball can bounce again off a second shield', () => {
  const shielded1 = worm({
    id: 'guardian-1',
    segments: [{ x: 100, y: 0 }],
    state: { shield: true, fireballCooldown: 0 },
  })
  const projectile = fb({
    id: 'fb-1',
    ownerId: 'shooter',
    position: { x: 90, y: 0 },
    radius: 5,
    velocity: { x: 50, y: 0 },
  })
  const opt = { ...opts(), headRadius: 8, bodyRadius: 8 }
  const first = resolveCollisions([shielded1], [projectile], [], opt)
  const bounced1 = first.fireballs[0]!

  const shielded2 = worm({
    id: 'guardian-2',
    segments: [{ x: bounced1.position.x, y: bounced1.position.y }],
    state: { shield: true, fireballCooldown: 0 },
  })
  const second = resolveCollisions([shielded2], [bounced1], [], opt)
  assert.equal(second.snakes[0].alive, true, 'second shield also blocks the death')
  assert.equal(second.fireballs.length, 1)
  const bounced2 = second.fireballs[0]!
  assert.equal(bounced2.bounced, true)
  assert.ok(bounced2.velocity.x > 0, 'reflected again, now heading back the other way')
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
  assert.equal(out.foodEatenCount['alpha'], 1)
  assert.equal(out.foodEatenCount['zebra'], undefined)
})

test('foodEatenCount is a per-orb count, independent of orb mass value', () => {
  const s = worm({ id: 'muncher', segments: [{ x: 0, y: 0 }] })
  const orbs = [
    food({ id: 'small', position: { x: 0, y: 0 }, radius: 14, mass: 1 }),
    food({ id: 'big-corpse-orb', position: { x: 0, y: 0 }, radius: 14, mass: 5 }),
  ]
  // Both orbs sit on top of the same head; resolve one at a time like the real loop would
  // across ticks (a single resolveCollisions call only lets one orb be picked up per head
  // per pass through `foods`, since the head itself doesn't move mid-call).
  const first = resolveCollisions([s], [], [orbs[0]!], opts())
  assert.equal(first.foodEatenCount['muncher'], 1)
  assert.equal(first.massGained['muncher'], 1)

  const second = resolveCollisions([s], [], [orbs[1]!], opts())
  assert.equal(second.foodEatenCount['muncher'], 1, 'count is per-orb, not scaled by mass')
  assert.equal(second.massGained['muncher'], 5)
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
