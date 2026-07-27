import type { Vec2 } from './snake'

export type { Vec2 }

/**
 * Client → server player intent for one simulation step.
 *
 * No world positions: only facing and discrete ability edges/held flags.
 * Binary framing can quantize `direction` (e.g. i8/i16 fixed) and pack booleans into a bitmask.
 */
export type PlayerInput = {
  /** Desired facing; server should normalize and clamp to a unit vector for determinism. */
  direction: Vec2
  /** Edge or held fire action (match your net contract; often edge-triggered per tick). */
  fire: boolean
  shield: boolean
  boost: boolean
  turbo: boolean
}
