import assert from 'node:assert/strict'
import test from 'node:test'
import type { FoodOrb } from '../contracts/world'
import { createEmptyWorld, tick, type TickInputs } from '../gameLoop.ts'

function idleInputs(...ids: string[]): TickInputs {
  const record: TickInputs = {}
  for (const id of ids) {
    record[id] = {
      abilities: {
        fireballTriggered: false,
        shieldHeld: false,
        boostHeld: false,
        turboHeld: false,
      },
    }
  }
  return record
}

test('advances deterministic tick counter', () => {
  const world = createEmptyWorld({
    bounds: { center: { x: 0, y: 0 }, radius: 1_000 },
  })
  const next = tick(world, {}, 1 / 60)
  assert.equal(next.tick, world.tick + 1)
})

test('replay with identical seeds matches salient slices', () => {
  const world = createEmptyWorld({
    bounds: { center: { x: 0, y: 0 }, radius: 5_000 },
    snakes: [
      {
        id: 'solo',
        segments: [{ x: 0, y: 0 }],
        direction: Math.PI / 4,
        speed: 120,
        alive: true,
      },
    ],
    snakeMassById: { solo: 40 },
  })

  const inputs = idleInputs('solo')
  inputs['solo'].abilities.boostHeld = true

  const a = tick(world, inputs, 1 / 30)
  const b = tick(structuredClone(world), structuredClone(inputs), 1 / 30)

  assert.deepEqual(a.snakes[0]?.segments, b.snakes[0]?.segments)
  assert.deepEqual(a.snakeMassById, b.snakeMassById)
  assert.deepEqual(a.fireballs.map((fb) => fb.id), b.fireballs.map((fb) => fb.id))
  assert.deepEqual(a.food.map((f) => f.id).sort(), b.food.map((f) => f.id).sort())
})

test('applies directional input before movement integration', () => {
  const world = createEmptyWorld({
    bounds: { center: { x: 0, y: 0 }, radius: 5_000 },
    snakes: [
      {
        id: 'p1',
        segments: [{ x: 0, y: 0 }],
        direction: 0,
        speed: 50,
        alive: true,
      },
    ],
  })

  const inputs = idleInputs('p1')
  inputs['p1'].direction = Math.PI / 2

  const next = tick(world, inputs, 0.05, { headTurnRadPerSec: 1e9 })
  const head = next.snakes[0].segments[0]
  assert.ok(Math.abs(head.x - 0) < 1e-6)
  assert.ok(head.y > 2)
})

test('collision grants orb mass exactly once even when food module runs afterward', () => {
  const snack: FoodOrb = {
    id: 'field-orb-1',
    fieldId: 'test-field',
    position: { x: 5, y: 0 },
    velocity: { x: 0, y: 0 },
    radius: 2,
    mass: 3,
    kind: 'normal',
  }

  const world = createEmptyWorld({
    bounds: { center: { x: 0, y: 0 }, radius: 5_000 },
    snakes: [
      {
        id: 'collector',
        segments: [{ x: 5, y: 0 }],
        direction: 0,
        speed: 0,
        alive: true,
      },
    ],
    snakeMassById: { collector: 10 },
    food: [snack],
  })

  const next = tick(world, idleInputs('collector'), 0)

  assert.equal(next.snakeMassById['collector'], 13)
  assert.equal(next.food.some((o) => o.id === snack.id), false)
})

test('integrates existing projectiles before collision checks', () => {
  const world = createEmptyWorld({
    bounds: { center: { x: 0, y: 0 }, radius: 5_000 },
    snakes: [
      {
        id: 'solo',
        segments: [{ x: 0, y: 0 }],
        direction: 0,
        speed: 0,
        alive: true,
      },
    ],
    snakeMassById: { solo: 1 },
    fireballs: [
      {
        id: 'ext',
        ownerId: 'solo',
        position: { x: 1_000, y: 0 },
        velocity: { x: 40, y: 0 },
        radius: 3,
      },
    ],
  })

  const next = tick(world, idleInputs('solo'), 0.25)
  assert.equal(next.fireballs.length, 1)
  assert.ok(Math.abs(next.fireballs[0].position.x - (1_000 + 40 * 0.25)) < 1e-6)
})

test('fireball despawns once it travels past fireballMaxRangePx from its spawn point', () => {
  const world = createEmptyWorld({
    bounds: { center: { x: 0, y: 0 }, radius: 5_000 },
    snakes: [
      {
        id: 'solo',
        segments: [{ x: 0, y: 0 }],
        direction: 0,
        speed: 0,
        alive: true,
      },
    ],
    snakeMassById: { solo: 1 },
    fireballs: [
      {
        id: 'far-traveler',
        ownerId: 'solo',
        position: { x: 850, y: 0 },
        spawnPosition: { x: 0, y: 0 },
        velocity: { x: 100, y: 0 },
        radius: 3,
      },
    ],
  })

  // 850 + 100*0.5 = 900, at/over the 900px default range -> despawned this tick
  const next = tick(world, idleInputs('solo'), 0.5)
  assert.equal(next.fireballs.length, 0)
})

test('fireball within range survives the tick', () => {
  const world = createEmptyWorld({
    bounds: { center: { x: 0, y: 0 }, radius: 5_000 },
    snakes: [
      {
        id: 'solo',
        segments: [{ x: 0, y: 0 }],
        direction: 0,
        speed: 0,
        alive: true,
      },
    ],
    snakeMassById: { solo: 1 },
    fireballs: [
      {
        id: 'still-flying',
        ownerId: 'solo',
        position: { x: 100, y: 0 },
        spawnPosition: { x: 0, y: 0 },
        velocity: { x: 40, y: 0 },
        radius: 3,
      },
    ],
  })

  const next = tick(world, idleInputs('solo'), 0.25)
  assert.equal(next.fireballs.length, 1)
})
