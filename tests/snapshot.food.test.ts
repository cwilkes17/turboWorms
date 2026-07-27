import assert from 'node:assert/strict'
import test from 'node:test'

import type { World } from '../contracts/world'
import { selectFoodForSnapshot } from '../server.ts'

test('selectFoodForSnapshot keeps closest orbs to an alive head when over cap', () => {
  const w: World = {
    bounds: { center: { x: 0, y: 0 }, radius: 10_000 },
    spawnFields: [],
    snakes: [
      {
        id: 'p1',
        segments: [{ x: 100, y: 0 }],
        mass: 20,
        direction: 0,
        speed: 1,
        alive: true,
        state: { shield: false, fireballCooldown: 0 },
      },
    ],
    food: [
      {
        id: 'z-far',
        fieldId: 'f',
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        radius: 2,
        mass: 1,
        kind: 'normal',
      },
      {
        id: 'a-near',
        fieldId: 'f',
        position: { x: 95, y: 0 },
        velocity: { x: 0, y: 0 },
        radius: 2,
        mass: 1,
        kind: 'normal',
      },
    ],
    fireballs: [],
    snakeMassById: { p1: 20 },
    foodRng: 1,
    foodNextOrbId: 1,
    foodSpawnAccumSec: {},
    nextFireballId: 1,
    nextFoodSpawnId: 1,
    tick: 0,
  }

  const out = selectFoodForSnapshot(w, 1)
  assert.equal(out.length, 1)
  assert.equal(out[0]!.id, 'a-near')
})

test('selectFoodForSnapshot with cap 0 sends all orbs', () => {
  const w: World = {
    bounds: { center: { x: 0, y: 0 }, radius: 100 },
    spawnFields: [],
    snakes: [],
    food: [
      {
        id: '1',
        fieldId: 'f',
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        radius: 2,
        mass: 1,
        kind: 'normal',
      },
      {
        id: '2',
        fieldId: 'f',
        position: { x: 5, y: 0 },
        velocity: { x: 0, y: 0 },
        radius: 2,
        mass: 1,
        kind: 'normal',
      },
    ],
    fireballs: [],
    snakeMassById: {},
    foodRng: 1,
    foodNextOrbId: 1,
    foodSpawnAccumSec: {},
    nextFireballId: 1,
    nextFoodSpawnId: 1,
    tick: 0,
  }
  const out = selectFoodForSnapshot(w, 0)
  assert.equal(out.length, 2)
})
