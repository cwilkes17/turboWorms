import assert from 'node:assert/strict'
import test from 'node:test'
import type { Snake } from '../contracts/snake'
import {
  BOOST_MASS_DRAIN_PER_SEC,
  BOOST_SPEED_MUL,
  FIREBALL_MASS_FRACTION,
  MASS_EPS,
  SHIELD_DRAIN_PER_SEC,
  TURBO_DRAIN_PER_SEC,
  TURBO_SPEED_MUL,
  type AbilityInput,
  type AbilityTickCtx,
  type SnakeWithMass,
  headRadiusFromMass,
  tickAbilities,
} from '../abilities.ts'

function ctx(overrides: Partial<AbilityTickCtx> = {}): AbilityTickCtx {
  return {
    intrinsicSpeed: 100,
    flatProjectileSpeed: 250,
    nextFireballId: 11,
    ...overrides,
  }
}

function worm(overrides: Partial<SnakeWithMass> & Pick<SnakeWithMass, 'mass'>): SnakeWithMass {
  return {
    id: 'p1',
    segments: [{ x: 5, y: -2 }],
    direction: Math.PI / 2,
    speed: 10,
    alive: true,
    ...overrides,
  }
}

const idleInput: AbilityInput = {
  fireballTriggered: false,
  shieldHeld: false,
  boostHeld: false,
  turboHeld: false,
}

test('fireball spends 10% mass and preserves determinism across identical ticks', () => {
  const s = worm({ mass: 80 })
  const input: AbilityInput = { ...idleInput, fireballTriggered: true }
  const a = tickAbilities(s, input, 0.016, ctx({ nextFireballId: 1 }))
  const b = tickAbilities(s, input, 0.016, ctx({ nextFireballId: 1 }))
  assert.equal(a.snake.mass, b.snake.mass)
  assert.ok(Math.abs(a.snake.mass - 80 * (1 - FIREBALL_MASS_FRACTION)) < 1e-9)
})

test('fireball spawns projectile at snake head aligned with snake.direction', () => {
  const s = worm({
    segments: [{ x: 3, y: -4 }],
    direction: Math.PI / 6,
    mass: 40,
  })
  const input: AbilityInput = { ...idleInput, fireballTriggered: true }
  const out = tickAbilities(s, input, 0, ctx({ nextFireballId: 2 }))
  assert.equal(out.fireballsSpawned.length, 1)
  const fb = out.fireballsSpawned[0]
  assert.deepEqual(fb.position, { x: 3, y: -4 })
  assert.equal(fb.radius, headRadiusFromMass(40))

  assert.ok(Math.abs(fb.velocity.x - Math.cos(Math.PI / 6) * 250) < 1e-9)
  assert.ok(Math.abs(fb.velocity.y - Math.sin(Math.PI / 6) * 250) < 1e-9)
  assert.equal(out.nextFireballId, 3)
})

test('fireball requires positive mass while alive', () => {
  const s = worm({ mass: 0, alive: true })
  const dead = worm({ mass: 20, alive: false })
  const input: AbilityInput = { ...idleInput, fireballTriggered: true }
  const out = tickAbilities(s, input, 0.05, ctx())
  assert.equal(out.fireballsSpawned.length, 0)
  assert.equal(out.snake.mass, 0)

  const outDead = tickAbilities(dead, input, 0.05, ctx())
  assert.equal(outDead.fireballsSpawned.length, 0)
  assert.equal(outDead.snake.mass, dead.mass)
})

test('shield drains 1% of mass per second applied after optional fireball', () => {
  const base = worm({ mass: 200 })
  const input: AbilityInput = { ...idleInput, shieldHeld: true }
  const out = tickAbilities(base, input, 1, ctx())
  assert.ok(Math.abs(out.snake.mass - base.mass * (1 - SHIELD_DRAIN_PER_SEC)) < 1e-9)
  assert.equal(out.shieldActive, true)
})

test('boost adds +50% speed and consumes 2 mass per second when affordable', () => {
  const s = worm({ mass: 20 })
  const input: AbilityInput = { ...idleInput, boostHeld: true }
  const baseline = ctx({ intrinsicSpeed: 120 })
  const out = tickAbilities(s, input, 1, baseline)
  assert.ok(Math.abs(out.snake.mass - (20 - BOOST_MASS_DRAIN_PER_SEC)) < 1e-9)
  assert.ok(Math.abs(out.effectiveSpeed - 120 * BOOST_SPEED_MUL) < 1e-9)
})

test('boost does not activate if constant drain cannot be paid for this timestep', () => {
  const s = worm({ mass: 1 })
  const input: AbilityInput = { ...idleInput, boostHeld: true }
  const out = tickAbilities(s, input, 1, ctx({ intrinsicSpeed: 50 }))
  assert.equal(out.snake.mass, 1)
  assert.equal(out.effectiveSpeed, 50)
})

test('turbo grants +200% speed and consumes 10% mass per second, suppressing boost', () => {
  const s = worm({ mass: 100 })
  const input: AbilityInput = {
    fireballTriggered: false,
    shieldHeld: false,
    boostHeld: true,
    turboHeld: true,
  }
  const out = tickAbilities(s, input, 1, ctx({ intrinsicSpeed: 10 }))
  assert.ok(Math.abs(out.snake.mass - 100 * (1 - TURBO_DRAIN_PER_SEC)) < 1e-9)
  assert.ok(Math.abs(out.effectiveSpeed - 10 * TURBO_SPEED_MUL) < 1e-9)
})

test('shield active flag drops off when drained mass hits zero', () => {
  const s = worm({ mass: 0.001 })
  const hugeDt = 1e6
  const out = tickAbilities(
    s,
    { fireballTriggered: false, shieldHeld: true, boostHeld: false, turboHeld: false },
    hugeDt,
    ctx()
  )
  assert.ok(out.snake.mass <= MASS_EPS)
  assert.equal(out.shieldActive, false)
})

test('shield drain fraction applies after fireball mass reduction on same tick', () => {
  const s = worm({ mass: 100 })
  const input: AbilityInput = {
    fireballTriggered: true,
    shieldHeld: true,
    boostHeld: false,
    turboHeld: false,
  }
  const out = tickAbilities(s, input, 1, ctx({ nextFireballId: 1 }))
  const afterFire = 100 * (1 - FIREBALL_MASS_FRACTION)
  const expectedMass = afterFire * (1 - SHIELD_DRAIN_PER_SEC)
  assert.ok(Math.abs(out.snake.mass - expectedMass) < 1e-9)
  assert.equal(out.shieldActive, true)
})
