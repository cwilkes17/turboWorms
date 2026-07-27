import assert from 'node:assert/strict'
import test from 'node:test'
import type { Snake } from '../contracts/snake'
import type { SpawnField, WorldBounds } from '../contracts/world'
import {
  MAX_FOOD_SPEED,
  FOOD_DOUBLE_RADIUS,
  FOOD_NORMAL_RADIUS,
  SPAWN_SECONDS_PER_ORB,
  createFoodSimState,
  generateSpawnFields,
  random01,
  sampleRadiusTowardCenter,
  tickFood,
} from '../food.ts'

function hypot(a: number, b: number): number {
  return Math.sqrt(a * a + b * b)
}

function makeSnake(overrides: Partial<Snake> & Pick<Snake, 'segments'>): Snake {
  return {
    id: 's1',
    direction: 0,
    speed: 0,
    alive: true,
    ...overrides,
  }
}

function smallField(overrides: Partial<SpawnField> & Pick<SpawnField, 'id'>): SpawnField {
  return {
    center: { x: 0, y: 0 },
    radius: 50,
    size: 'small',
    isCenterField: false,
    ...overrides,
  }
}

test('random01 is deterministic and stays in [0, 1)', () => {
  let r = 0xabc12345
  const a: number[] = []
  for (let i = 0; i < 5; i++) {
    let u = 0
    ;[u, r] = random01(r)
    a.push(u)
  }
  let r2 = 0xabc12345
  const b: number[] = []
  for (let i = 0; i < 5; i++) {
    let u = 0
    ;[u, r2] = random01(r2)
    b.push(u)
  }
  assert.deepEqual(a, b)
  for (const u of a) assert.ok(u >= 0 && u < 1)
})

test('sampleRadiusTowardCenter biases inward (mean of many samples < R/2)', () => {
  const R = 1000
  let s = 0
  let rng = 0x11111111
  const n = 2000
  for (let i = 0; i < n; i++) {
    let u = 0
    ;[u, rng] = random01(rng)
    s += sampleRadiusTowardCenter(u, R)
  }
  const mean = s / n
  assert.ok(mean < R * 0.5, `mean radius ${mean} should be nearer center than uniform ~${0.667 * R}`)
})

test('same food tick inputs yield identical outputs', () => {
  const fields = [smallField({ id: 'fa' })]
  const base = createFoodSimState(99)
  const snakes: Snake[] = []
  const dt = 1 / 30
  const a = tickFood(base, fields, snakes, dt)
  const b = tickFood(base, fields, snakes, dt)
  assert.deepEqual(a.state, b.state)
  assert.deepEqual(a.massGained, b.massGained)
})

test('food drifts: positions change when no spawn and no eat', () => {
  const field = smallField({ id: 'fa' })
  const orb = {
    id: 'food-1',
    fieldId: 'fa',
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    radius: FOOD_NORMAL_RADIUS,
    mass: 1,
    kind: 'normal' as const,
  }
  const s0 = createFoodSimState(4242)
  const st: typeof s0 = { ...s0, orbs: [orb] }
  const t1 = tickFood(st, [field], [], 0.05)
  const t2 = tickFood(t1.state, [field], [], 0.05)
  const p0 = st.orbs[0].position
  const p1 = t1.state.orbs[0].position
  const p2 = t2.state.orbs[0].position
  assert.notDeepEqual(p1, p0)
  assert.notDeepEqual(p2, p1)
})

test('Brownian motion clamps max speed each tick', () => {
  const field = smallField({ id: 'fa' })
  const orb = {
    id: 'food-1',
    fieldId: 'fa',
    position: { x: 0, y: 0 },
    velocity: { x: 1000, y: 1000 },
    radius: FOOD_NORMAL_RADIUS,
    mass: 1,
    kind: 'normal' as const,
  }
  const st = { ...createFoodSimState(777), orbs: [orb] }
  const out = tickFood(st, [field], [], 0.016)
  const v = out.state.orbs[0].velocity
  const speed = hypot(v.x, v.y)
  assert.ok(speed <= MAX_FOOD_SPEED + 1e-6)
})

test('spawn: one normal orb per field every SPAWN_SECONDS_PER_ORB', () => {
  const field = smallField({ id: 'only' })
  const s0 = createFoodSimState(1)
  const out = tickFood(s0, [field], [], SPAWN_SECONDS_PER_ORB)
  assert.equal(out.state.orbs.length, 1)
  assert.equal(out.state.orbs[0].kind, 'normal')
  assert.equal(out.state.orbs[0].radius, FOOD_NORMAL_RADIUS)
})

test('spawn: center field emits two double-size orbs per interval', () => {
  const field = smallField({ id: 'core', isCenterField: true })
  const s0 = createFoodSimState(2)
  const out = tickFood(s0, [field], [], SPAWN_SECONDS_PER_ORB)
  assert.equal(out.state.orbs.length, 2)
  for (const o of out.state.orbs) {
    assert.equal(o.kind, 'doubleSize')
    assert.equal(o.radius, FOOD_DOUBLE_RADIUS)
    assert.equal(o.mass, 1)
  }
})

test('food stays inside its spawn field disc after many ticks', () => {
  const field = smallField({ id: 'cage' })
  let state = createFoodSimState(0xfeed)
  const { state: withOrb } = tickFood(state, [field], [], SPAWN_SECONDS_PER_ORB)
  state = withOrb
  for (let i = 0; i < 80; i++) {
    const step = tickFood(state, [field], [], 0.05)
    state = step.state
    for (const o of state.orbs) {
      const d = hypot(o.position.x - field.center.x, o.position.y - field.center.y)
      assert.ok(d + o.radius <= field.radius + 1e-5, `${d} ${o.radius} ${field.radius}`)
    }
  }
})

test('consumption removes food and credits mass when head overlaps orb', () => {
  const field = smallField({ id: 'eat' })
  const orb = {
    id: 'food-99',
    fieldId: 'eat',
    position: { x: 10, y: 0 },
    velocity: { x: 0, y: 0 },
    radius: FOOD_NORMAL_RADIUS,
    mass: 1,
    kind: 'normal' as const,
  }
  const state = {
    ...createFoodSimState(555),
    orbs: [orb],
    nextOrbId: 100,
    spawnAccumSec: { eat: 0 },
  }
  const snake = makeSnake({ id: 'eater', segments: [{ x: 10, y: 0 }] })
  const out = tickFood(state, [field], [snake], 0)
  assert.equal(out.state.orbs.length, 0)
  assert.equal(out.massGained['eater'], 1)
})

test('dead snakes do not consume food', () => {
  const field = smallField({ id: 'eat' })
  const orb = {
    id: 'food-99',
    fieldId: 'eat',
    position: { x: 10, y: 0 },
    velocity: { x: 0, y: 0 },
    radius: FOOD_NORMAL_RADIUS,
    mass: 1,
    kind: 'normal' as const,
  }
  const state = { ...createFoodSimState(555), orbs: [orb], spawnAccumSec: {} }
  const snake = makeSnake({ id: 'dead', segments: [{ x: 10, y: 0 }], alive: false })
  const out = tickFood(state, [field], [snake], 0)
  assert.equal(out.state.orbs.length, 1)
  assert.deepEqual(out.massGained, {})
})

test('deterministic snake tie-break when two heads reach same orb (lower id wins)', () => {
  const field = smallField({ id: 'f1' })
  const orb = {
    id: 'food-1',
    fieldId: 'f1',
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    radius: FOOD_NORMAL_RADIUS,
    mass: 1,
    kind: 'normal' as const,
  }
  const state = { ...createFoodSimState(1), orbs: [orb], spawnAccumSec: {} }
  const sB = makeSnake({ id: 'b', segments: [{ x: 0, y: 0 }] })
  const sA = makeSnake({ id: 'a', segments: [{ x: 0, y: 0 }] })
  const out = tickFood(state, [field], [sB, sA], 0)
  assert.equal(out.state.orbs.length, 0)
  assert.equal(out.massGained['a'], 1)
  assert.equal(out.massGained['b'], undefined)
})

test('generateSpawnFields places more fields nearer world center on average', () => {
  const bounds: WorldBounds = { center: { x: 0, y: 0 }, radius: 2000 }
  const { fields } = generateSpawnFields(bounds, 64, 0xcafebeef)
  let sum = 0
  for (const f of fields) sum += hypot(f.center.x - bounds.center.x, f.center.y - bounds.center.y)
  const avg = sum / fields.length
  assert.ok(avg < bounds.radius * 0.55)
})
