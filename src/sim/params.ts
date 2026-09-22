import { DEFAULT_FLOCK_PRESET, flockBehaviour } from './presets';

/**
 * How the flock flies, which is everything a named preset in `presets.ts`
 * carries. What `SimParams` adds around it is the user's own: how many boids
 * there are, where they start, and what the cursor does to them.
 */
export interface FlockBehaviour {
  /**
   * Boids closer than this push each other apart. World units.
   *
   * The one value here that is not just a starting point. At 6 against a
   * five-unit mark the flock flew nose to tail and every trail crossed every
   * other; at 12 they are close without overlapping. A looser flock is also a
   * cheaper one, since the neighbour search costs the square of how many
   * neighbours there are: the step went from 11.5 ms to 4.0 ms.
   */
  separationRadius: number;
  /** Neighbourhood radius for alignment and cohesion. World units. */
  neighbourRadius: number;
  /**
   * Half-angle of the forward field of view, in radians. Alignment and cohesion
   * ignore neighbours outside it, which is what stops the flock collapsing into
   * a uniform ball. Separation stays omnidirectional: a blind spot in the rule
   * that prevents collisions reads as a bug.
   */
  fieldOfView: number;

  separationWeight: number;
  alignmentWeight: number;
  cohesionWeight: number;
  /**
   * Caps the combined steering of the three rules above, in world units per
   * second squared. It is what makes the weights a ratio: without it, raising
   * one weight both shifts the balance and makes every boid snap harder, so no
   * slider does one legible thing.
   */
  maxForce: number;

  /** Weak pull toward the origin, so the flock migrates but never escapes. */
  originPull: number;

  minSpeed: number;
  maxSpeed: number;
  /** Radians per second. Caps how sharply a boid can turn. */
  maxTurnRate: number;

  /**
   * Steering jitter, world units per second squared. Keeps a flock that has
   * found equilibrium from freezing into a lattice.
   */
  wanderStrength: number;
  /** How fast a boid's wander direction drifts, in radians per second. */
  wanderRate: number;
}

/**
 * Everything the user can change about the flock. Every field takes effect on
 * the next step, with no restart.
 */
export interface SimParams extends FlockBehaviour {
  /** How many boids are simulated. Never exceeds the backend's capacity. */
  count: number;

  /** Cursor force: positive attracts, negative repels. */
  cursorStrength: number;
  /** World units. Outside this radius the cursor has no effect. */
  cursorRadius: number;

  /** Radius of the disc the seeded starting flock is scattered over. */
  spawnRadius: number;
}

/** The first preset, with the fields no preset carries around it. */
export const DEFAULT_SIM_PARAMS: Readonly<SimParams> = Object.freeze({
  count: 500,

  ...flockBehaviour(DEFAULT_FLOCK_PRESET),

  cursorStrength: -500,
  cursorRadius: 90,

  spawnRadius: 400,
});
