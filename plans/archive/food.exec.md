# food.exec.md

## Goal

Implement drifting food particles.

## Behavior

* Spawn randomly across world
* Move using Brownian motion
* Food orbs spawn in higher density closer you are to center map, the center orb feilds will spawn double food orbs, which are slighly larger in addition to normal sized food orbs, worth 1
* food spawns from all fields at 1 per 3 seconds, spwan fields vary in size from small medium and large
* small med and large feilds are placed randomly around the map, but can overlap and are placed such that they increase in a linear quantity the closer you get to the center of the circlar map
* Food orbs are spawned in as randomly colored glowy orbs that float around a field, contained brownian motion, spawn points are random points within a "food spawn field"


## Brownian Motion

Each tick:

* Add small random delta to velocity
* Clamp max speed

## Rules

* Food consumed on collision with snake head
* Increases snake mass

## Tests

* Food moves randomly
* Food is consumed correctly
* Mass increases on eat
