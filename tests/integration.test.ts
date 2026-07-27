import assert from 'node:assert/strict'
import test from 'node:test'

import { BOOST_SPEED_MUL } from '../abilities.ts'
import type { Snake } from '../contracts/snake'
import type { FoodOrb } from '../contracts/world'
import {
  createEmptyWorld,
  IDLE_ABILITIES,
  MASS_PER_SEGMENT,
  targetSegmentCountForMass,
  tick,
  type TickInputs,
} from '../gameLoop.ts'

function snakeBase(partial: Partial<Snake> & Pick<Snake, 'id'>): Snake {
  return {
    segments: [{ x: 0, y: 0 }],
    direction: 0,
    speed: 100,
    alive: true,
    mass: 20,
    state: { shield: false, fireballCooldown: 0 },
    ...partial,
  }
}

test('eating food increases mass and length past the next MASS_PER_SEGMENT step', () => {
  const id = 'p1'
  const orb: FoodOrb = {
    id: 'o1',
    fieldId: 'f1',
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    radius: 2,
    mass: 15,
    kind: 'normal',
  }

  const w = createEmptyWorld({
    bounds: { center: { x: 0, y: 0 }, radius: 10_000 },
    spawnFields: [],
    snakes: [snakeBase({ id, segments: [{ x: 0, y: 0 }] })],
    food: [orb],
    snakeMassById: { [id]: 10 },
    nextFoodSpawnId: 2,
  })

  assert.equal(targetSegmentCountForMass(10), 1)
  assert.equal(targetSegmentCountForMass(25), 2)

  const after = tick(w, { [id]: { direction: 0, abilities: IDLE_ABILITIES } }, 0.04)
  assert.equal(after.snakeMassById[id], 25)
  const body = after.snakes.find((s) => s.id === id)!
  assert.equal(body.segments.length, 2)
})

test('boost held increases travel vs released; ratio matches BOOST_SPEED_MUL', () => {
  const id = 'p1'
  const w = createEmptyWorld({
    bounds: { center: { x: 0, y: 0 }, radius: 10_000 },
    spawnFields: [],
    snakes: [snakeBase({ id, segments: [{ x: 0, y: 0 }] })],
    snakeMassById: { [id]: 200 },
  })
  const dt = 0.04
  const hold: TickInputs = { [id]: { direction: 0, abilities: { ...IDLE_ABILITIES, boostHeld: true } } }
  const release: TickInputs = { [id]: { direction: 0, abilities: { ...IDLE_ABILITIES, boostHeld: false } } }

  const boosted = tick(w, hold, dt)
  const x0 = w.snakes.find((s) => s.id === id)!.segments[0]!.x
  const x1 = boosted.snakes.find((s) => s.id === id)!.segments[0]!.x
  const dxBoost = x1 - x0

  const slowed = tick(boosted, release, dt)
  const x2 = slowed.snakes.find((s) => s.id === id)!.segments[0]!.x
  const dxPlain = x2 - x1

  assert.ok(dxBoost > 0 && dxPlain > 0)
  const ratio = dxBoost / dxPlain
  assert.ok(ratio > BOOST_SPEED_MUL * 0.9, `ratio ${ratio} vs ${BOOST_SPEED_MUL}`)
  assert.ok(ratio < BOOST_SPEED_MUL * 1.11)
})

test('fireball spawns on trigger and advances next tick integration', () => {
  const id = 'p1'
  const w = createEmptyWorld({
    bounds: { center: { x: 0, y: 0 }, radius: 10_000 },
    spawnFields: [],
    snakes: [snakeBase({ id, segments: [{ x: 0, y: 0 }], direction: 0 })],
    snakeMassById: { [id]: 12 },
    nextFireballId: 1,
  })
  /** Large dt so post-integrate fireball clears head overlap (collision uses bounded radii vs large ability radius). */
  const dt = 0.2
  const fireOnce: TickInputs = {
    [id]: { direction: 0, abilities: { ...IDLE_ABILITIES, fireballTriggered: true } },
  }
  const idle: TickInputs = { [id]: { direction: 0, abilities: IDLE_ABILITIES } }

  const opts = { flatProjectileSpeed: 280 as const }

  const t1 = tick(w, fireOnce, dt, opts)
  assert.equal(t1.fireballs.length, 1)
  const fb1 = t1.fireballs[0]!
  assert.equal(fb1.velocity.x > 0, true)

  const t2 = tick(t1, idle, dt, opts)
  assert.equal(t2.fireballs.length, 1)
  const fb2 = t2.fireballs[0]!
  assert.ok(fb2.position.x > fb1.position.x)
})

test('fireball does not kill a far away snake while traveling', () => {
  const a = 'a'
  const b = 'b'
  const w = createEmptyWorld({
    bounds: { center: { x: 0, y: 0 }, radius: 10_000 },
    spawnFields: [],
    snakes: [
      snakeBase({ id: a, segments: [{ x: 0, y: 0 }], direction: 0 }),
      snakeBase({ id: b, segments: [{ x: 6000, y: 0 }] }),
    ],
    snakeMassById: { [a]: 120, [b]: 50 },
    nextFireballId: 1,
  })
  const dt = 0.05
  let cur = w
  for (let i = 0; i < 30; i++) {
    cur = tick(
      cur,
      {
        [a]: { direction: 0, abilities: { ...IDLE_ABILITIES, fireballTriggered: i === 0 } },
        [b]: { direction: Math.PI, abilities: IDLE_ABILITIES },
      },
      dt,
      { flatProjectileSpeed: 280 }
    )
  }
  assert.equal(cur.snakes.find((s) => s.id === b)!.alive, true)
})
