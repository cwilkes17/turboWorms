# game_design.md

## Core Loop

* Eat food → grow in length and diameter → gain resource pool
* Spend resource → abilities (fireball, shield, boost)
* Kill others → absorb dropped mass, on death snakes spawn large food orbs

## Feel

* interpolate direction over ~50ms, a little bit more fluid, WASD for direction input
* Fast, chaotic, twitchy PvP

## World

* Infinite map illusion
* Camera centered on player
* Zoom out slowly as snake grows
* initially whole snake is visable because its so small but as the snake grows we will have to cut some portion out of it to limit the amount of visable data to the user, we never want to zoom out such that the play can see the whole map, thats too much data, so as we grow we have to be mindful of there the upper limit of zoom is, id say the limit is 15% of the map and its a logrithmic curve to get there
* there is a ui element that displays the current position of every worm on the map, sort of like a
* minimap, much like slither.io, small, in a corner of the UI, overlayed, semi transparent.

## Scale

* Target: 100–200 players per room

## Movement

* Constant forward motion
* WASD sets direction instantly (no turn radius)
* Boost: +50% speed
* Turbo Boost: +200% speed

## Combat Rules

* Head-to-anything = death
* Body collision (enemy hits your body with head) = enemy dies
* Fireball hit:

  * Instant death (head or body)

## Resource System (CRITICAL)

* Resource = snake mass (length)
* players start at zero mass, and eat orbs to get bigger, no minimum size required for death, even if your food is 0 you spawn 80 food if someone kills you

### Costs

* Fireball: 25% of total mass
* Shield: 5% mass per second
* Boost: small constant drain, 2 food orbs per second
* Turbo Boost: 10% mass per second

## Abilities

### Fireball

* Straight-line projectile
* Size scales with snake head radius
* Instant kill on hit to head
* 5 second cool down

### Shield

* Active drain ability
* Prevents death while active
* glowy transparent overlay effect on worm
* fireballs trigger "cool sheild absorbsion"

## Food

* Random spawn across map
* Brownian motion drifting
* Multicolored glowing particles
* Food orbs spawn in higher density closer you are to center map, the center orb feilds will spawn double food orbs, which are slighly larger in addition to normal sized food orbs, worth 1
* food spawns from all fields at 1 per 3 seconds, spwan fields vary in size from small medium and large
* small med and large feilds are placed randomly around the map, but can overlap and are placed such that they increase in a linear quantity the closer you get to the center of the circlar map
* Food orbs are spawned in as randomly colored glowy orbs that float around a field, contained brownian motion, spawn points are random points within a "food spawn field"

