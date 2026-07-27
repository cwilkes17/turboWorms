# Bug: Food Visibility Mismatch

## Observed Behavior

* Player moves through visually sparse area
* Snake mass increases without visible food
* Indicates invisible or desynced food entities

## Expected Behavior

* Every consumable food entity must be rendered
* No invisible food collisions

## Possible Causes

* Renderer not drawing all food
* Server sending subset of food
* Client culling too aggressively
* Desync between simulation and render state

## Repro Steps

1. Move through low-density field
2. Observe growth without visible food

## Constraints

* Do NOT change food spawn logic
* Focus only on visibility + sync
