# collision.exec.md

## Goal

Resolve all collisions deterministically per tick.

## Entities

* snakes (segments)
* fireballs (circles)
* food (circles)

## Collision Types

### 1. Snake Head vs Snake Body

* If head intersects ANY segment:
  → head snake dies

### 2. Snake Head vs Snake Head

* Both die

### 3. Fireball vs Snake Head

* Snake dies instantly
* Fireball removed

### 4. Fireball vs Snake Body

* Fireball removed
* Snake unaffected

### 5. Snake Head vs Food

* Food removed
* Snake mass increases

## Steps (ORDER MATTERS)

1. Build spatial index (grid or quadtree)
2. Resolve fireball collisions
3. Resolve snake head collisions
4. Resolve food collisions
5. Mark dead snakes
6. Spawn food from dead snakes

## Optimization

* Only check:

  * nearby segments
  * nearby food
  * nearby fireballs

## Tests

* Head-to-body kills correctly
* Fireball absorbed by body
* Fireball kills head
* Multiple collisions same tick handled deterministically

## Constraints

* No randomness in collision resolution
* Same input → same result every time
