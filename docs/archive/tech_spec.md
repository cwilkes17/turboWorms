# tech_spec.md

## Server

* Language: Go or Node (decide)
* Tick loop: fixed timestep
* Authoritative simulation

## Client

* React shell
* Canvas rendering (NOT DOM)

## Networking

* WebSockets

* Client sends:

  * direction
  * ability triggers

* Server sends:

  * snapshot (compressed)

## Performance Constraints

* Must handle 100 snakes
* Tick must complete < 16ms

## Anti-Cheat

* Client cannot set position
* Server validates all movement


## Rendering Rules for Agents

* Do NOT use React components for rendering entities

* Use Canvas 2D API

* All visuals must be functions:

  * drawSnake(ctx, snake)
  * drawFood(ctx, food)

* No external assets in Phase 1

* Use procedural rendering only

* Must support:

  * 200 snakes
  * 2000 food particles
