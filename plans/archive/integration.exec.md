# integration.exec.md

## Goal

Ensure all systems work together correctly inside the game loop.

## Systems

* movement
* food
* abilities
* collision

## Source of Truth

* world state

## Tick Order (STRICT)

1. apply inputs
2. update ability states (toggle on/off)
3. movement
4. abilities (spawn fireballs, apply drains)
5. collision
6. food consumption
7. growth/shrink from mass changes

## Critical Rules

### Mass ↔ Length

* Eating food increases mass
* Mass increase → add segments
* Spending mass → remove segments from tail

### Abilities

* Must respect input state (on/off)
* Must stop when input stops
* Cannot stack unintentionally

### Fireballs

* Must exist as entities in world
* Must move each tick
* Must be included in snapshot

### Boost

* Active only while input is held
* Stops immediately when released

### Rendering Contract

* World must expose:

  * snakes
  * food
  * fireballs

## Tests

### Integration Tests

* Eating food increases length
* Boost toggles on/off correctly
* Fireball spawns and moves
* Fireball does NOT delete snake incorrectly

## Constraints

* No system mutates another system directly
* All changes go through world state
