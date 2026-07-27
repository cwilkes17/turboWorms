# networking.exec.md

## Goal

Synchronize game state across 100–200 players.

## Model

* Server authoritative
* Clients send inputs only

## Client (send)

* direction (WASD → vector)
* ability flags:

  * fire
  * shield
  * boost
  * turbo

## Server Tick (20–30Hz)

1. Collect inputs
2. Run simulation tick
3. Build snapshot
4. Broadcast snapshot

## Snapshot Structure (compressed)

{
snakes: [
{
id,
head: {x, y},
dir,
length,
visibleSegments (subset only)
}
],
food: [subset],
fireballs: [...]
}

## Bandwidth Optimization

* Send ONLY nearby entities
* Limit segment count per snake
* Quantize positions (float → int)

## Client Side

* Interpolate between snapshots
* Predict own movement (optional later)

## Tests

* 100 clients connected
* No desync over time
* Acceptable latency (~100ms)

## Constraints

* Server is source of truth
* Client cannot override position
