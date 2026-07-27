import type { Snake, Vec2 } from './contracts/snake'

export const SEGMENT_SPACING = 10

/** Max turning speed (rad/s) when steering toward networked input — prevents instantaneous flips into the spine (`headR + bodyR` overlaps `SEGMENT_SPACING` bends). */
export const DEFAULT_HEAD_TURN_RAD_PER_SEC = 12

/** Advance `currentRad` toward `targetRad` by at most `omega * dt` along the shortest arc. */
export function steerHeadingToward(
  currentRad: number,
  targetRad: number,
  dt: number,
  omegaRadPerSec: number = DEFAULT_HEAD_TURN_RAD_PER_SEC
): number {
  if (!Number.isFinite(currentRad) || !Number.isFinite(targetRad) || !Number.isFinite(dt)) return currentRad
  let diff = targetRad - currentRad
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  const cap = Math.max(0, Math.max(0, omegaRadPerSec) * Math.max(0, dt))
  if (diff > cap) return currentRad + cap
  if (diff < -cap) return currentRad - cap
  return targetRad
}

function directionUnit(direction: number): Vec2 {
  return { x: Math.cos(direction), y: Math.sin(direction) }
}

function hypot(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy)
}

/** Walk `arcDistance` along `polyline` from its first vertex. */
function pointAtArcDistanceAlongPolyline(polyline: Vec2[], arcDistance: number): Vec2 {
  if (polyline.length === 0) return { x: 0, y: 0 }
  if (arcDistance <= 0) return { x: polyline[0].x, y: polyline[0].y }

  let remaining = arcDistance

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]
    const b = polyline[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = hypot(dx, dy)
    if (len === 0) continue
    if (remaining <= len) {
      const t = remaining / len
      return { x: a.x + t * dx, y: a.y + t * dy }
    }
    remaining -= len
  }

  let i = polyline.length - 1
  while (i > 0) {
    const a = polyline[i - 1]
    const b = polyline[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = hypot(dx, dy)
    if (len > 0) {
      const ux = dx / len
      const uy = dy / len
      return { x: b.x + ux * remaining, y: b.y + uy * remaining }
    }
    i -= 1
  }

  const last = polyline[polyline.length - 1]
  return { x: last.x, y: last.y }
}

/**
 * Advances snake by one timestep: moves the head along `direction` and pulls the body
 * with fixed spacing along the trailing path (previous frame + new head motion).
 */
export function simulateMovement(
  snake: Snake,
  deltaTime: number,
  segmentSpacing: number = SEGMENT_SPACING
): Snake {
  const segments = snake.segments
  if (segments.length === 0) {
    return { ...snake, segments: [] }
  }

  const u = directionUnit(snake.direction)
  const headDelta = snake.speed * deltaTime
  const newHead: Vec2 = {
    x: segments[0].x + u.x * headDelta,
    y: segments[0].y + u.y * headDelta,
  }

  const trail: Vec2[] = [newHead, ...segments]
  const newSegments: Vec2[] = [newHead]
  for (let i = 1; i < segments.length; i++) {
    newSegments.push(pointAtArcDistanceAlongPolyline(trail, i * segmentSpacing))
  }

  return { ...snake, segments: newSegments }
}
