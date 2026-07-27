import assert from 'node:assert/strict'
import test from 'node:test'
import type { Snake, Vec2 } from '../contracts/snake'
import { SEGMENT_SPACING, simulateMovement, steerHeadingToward } from '../movement.ts'

const EPS = 1e-9

function approxVec(a: Vec2, b: Vec2, eps = EPS): void {
  assert.ok(Math.abs(a.x - b.x) <= eps, `x: ${a.x} vs ${b.x}`)
  assert.ok(Math.abs(a.y - b.y) <= eps, `y: ${a.y} vs ${b.y}`)
}

function makeSnake(overrides: Partial<Snake> & Pick<Snake, 'segments'>): Snake {
  return {
    id: 's1',
    direction: 0,
    speed: 1,
    alive: true,
    mass: 10,
    state: { shield: false, fireballCooldown: 0 },
    ...overrides,
  }
}

test('steerHeadingToward uses shortest arc and caps turn rate', () => {
  assert.ok(Math.abs(steerHeadingToward(0, Math.PI, 0.1, 10) - 1) < 1e-9)
  assert.ok(Math.abs(steerHeadingToward(0, -Math.PI, 0.1, 10) - -1) < 1e-9)
  assert.equal(steerHeadingToward(0, Math.PI / 2, 1, 1000), Math.PI / 2)
})

test('head advances by direction * speed * deltaTime', () => {
  const snake = makeSnake({
    segments: [{ x: 0, y: 0 }],
    direction: Math.PI / 2,
    speed: 2,
  })
  const dt = 0.5
  const next = simulateMovement(snake, dt)
  approxVec(next.segments[0], { x: 0, y: snake.speed * dt })
})

test('empty segments stay empty', () => {
  const snake = makeSnake({ segments: [] })
  const next = simulateMovement(snake, 0.016)
  assert.deepEqual(next.segments, [])
})

test('single-segment snake is only translated head', () => {
  const snake = makeSnake({
    segments: [{ x: 5, y: -3 }],
    direction: 0,
    speed: 10,
  })
  const dt = 0.1
  const next = simulateMovement(snake, dt)
  assert.equal(next.segments.length, 1)
  approxVec(next.segments[0], { x: 5 + snake.speed * dt, y: -3 })
})

test('straight worm: Euclidean spacing stays constant along the trail', () => {
  const n = 4
  const spacing = SEGMENT_SPACING
  const segments: Vec2[] = []
  for (let i = 0; i < n; i++) segments.push({ x: -i * spacing, y: 0 })
  const snake = makeSnake({ segments, direction: 0, speed: spacing })
  const dt = 1
  const next = simulateMovement(snake, dt, spacing)

  for (let i = 0; i < next.segments.length - 1; i++) {
    const a = next.segments[i]
    const b = next.segments[i + 1]
    const dist = hypot(b.x - a.x, b.y - a.y)
    assert.ok(
      Math.abs(dist - spacing) < 1e-6,
      `segment ${i} spacing ${dist} expected ${spacing}`
    )
  }
})

function hypot(a: number, b: number): number {
  return Math.sqrt(a * a + b * b)
}

test('segment count unchanged; no growth or shrink', () => {
  const segments: Vec2[] = [
    { x: 0, y: 0 },
    { x: -SEGMENT_SPACING, y: 0 },
    { x: -2 * SEGMENT_SPACING, y: 0 },
  ]
  const snake = makeSnake({ segments, direction: 0, speed: 4 })
  const next = simulateMovement(snake, 0.25)
  assert.equal(next.segments.length, snake.segments.length)
})

test('same inputs produce identical outputs (deterministic)', () => {
  const snake = makeSnake({
    segments: [
      { x: 1, y: 2 },
      { x: -5, y: 2 },
      { x: -12, y: 3 },
    ],
    direction: 0.7,
    speed: 30,
  })
  const dt = 1 / 60
  const a = simulateMovement(snake, dt)
  const b = simulateMovement(snake, dt)
  assert.deepEqual(a.segments, b.segments)
})

test('turning only uses current direction for head; same-tick result independent of hypothetical next direction', () => {
  const segments: Vec2[] = [
    { x: 0, y: 0 },
    { x: -SEGMENT_SPACING, y: 0 },
    { x: -2 * SEGMENT_SPACING, y: 0 },
  ]
  const base = makeSnake({ segments, direction: 0, speed: 5 })
  const dt = 0.02
  const moved = simulateMovement(base, dt)
  const wouldBeDifferentHead = makeSnake({
    segments,
    direction: Math.PI / 2,
    speed: 5,
  })
  const ifWeUsedOtherDir = simulateMovement(wouldBeDifferentHead, dt)
  assert.notDeepEqual(moved.segments[0], ifWeUsedOtherDir.segments[0])
  const again = simulateMovement(base, dt)
  assert.deepEqual(again.segments, moved.segments)
})

test('after many straight ticks, body stays collinear with constant spacing', () => {
  const spacing = SEGMENT_SPACING
  let snake = makeSnake({
    segments: [
      { x: 0, y: 0 },
      { x: -spacing, y: 0 },
      { x: -2 * spacing, y: 0 },
    ],
    direction: 0,
    speed: spacing,
  })
  for (let t = 0; t < 20; t++) snake = simulateMovement(snake, 1, spacing)
  for (let i = 0; i < snake.segments.length - 1; i++) {
    const d = hypot(
      snake.segments[i + 1].x - snake.segments[i].x,
      snake.segments[i + 1].y - snake.segments[i].y
    )
    assert.ok(Math.abs(d - spacing) < 1e-6)
  }
  for (const p of snake.segments) assert.ok(Math.abs(p.y) < 1e-6)
})

