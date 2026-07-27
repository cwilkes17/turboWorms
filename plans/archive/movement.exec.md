# movement.exec.md

## Goal

Implement deterministic snake movement per tick.

## Inputs

* snake.direction (unit vector)
* snake.speed (units per second)
* deltaTime (time per tick)

## Movement Rules

### Direction

* Direction is already resolved BEFORE movement
* Movement uses current direction only (no turning logic here)

### Head Movement

* Head moves forward:
  newHead = head + direction * speed * deltaTime

### Body Movement

* Each segment follows the previous segment
* Maintain fixed spacing between segments

### Segment Spacing

* Constant distance between segments (e.g. 10 units)

### Length Behavior

* Length does NOT change in movement system
* No growth or shrink here

### Determinism

* No randomness
* Same inputs must produce identical outputs

## Outputs

* Updated snake.segments array

## Steps

1. Move head forward
2. Shift segments to follow previous segment
3. Enforce spacing constraint

## Tests

* Snake moves forward correctly
* Segment spacing remains constant
* Turning affects future ticks only

## Constraints

* Pure function preferred
* No side effects
