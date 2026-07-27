# abilities.exec.md

## Goal

Implement resource-based abilities tied to snake mass.

## Inputs

* player input (fire, shield, boost)
* snake.mass

## Outputs

* updated snake state
* spawned projectiles

## Rules

### Fireball

* Costs 25% mass instantly
* Spawns projectile at head
* Direction = current heading
* Size = proportional to head radius

### Shield

* Active while key held
* Drains 5% mass per second
* Prevents death

### Boost

* Increases speed by 50%
* Small constant drain

### Turbo Boost

* Increases speed by 200%
* Drains 10% mass per second

## Steps

1. Check input flags
2. Validate sufficient mass
3. Deduct cost
4. Apply effect

## Tests

* Mass decreases correctly
* Cannot activate without enough mass
* Fireball spawns correctly
