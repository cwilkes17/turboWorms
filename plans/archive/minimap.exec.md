# minimap.exec.md

## Goal

Render all snakes as dots in a minimap.

## Rules

* Entire map is scaled down to small UI box
* Each snake = dot
* Player snake = highlighted

## Inputs

* full snake positions (head only)

## Output

* 2D minimap overlay

## Steps

1. Normalize world position → [0,1]
2. Scale into minimap size
3. Draw dots

## Performance

* Only use head positions
* No segments rendered

## Tests

* All snakes visible
* Positions accurate
* Updates smoothly
