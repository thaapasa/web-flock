/**
 * Everything the user can change about the flock's behaviour.
 *
 * Plain data on purpose: no methods, no class, nothing that holds a reference
 * to a backend. A parameter set is something you can clone, diff, serialise to
 * localStorage, paste into a chat, and hand to a GPU backend as a uniform
 * block without translation.
 *
 * Every field takes effect on the next `step`, with no restart — see CLAUDE.md.
 */
export interface SimParams {
  /** How many boids are simulated. Never exceeds the backend's capacity. */
  count: number;

  /** Boids closer than this push each other apart. World units. */
  separationRadius: number;
  /** Neighbourhood radius for alignment and cohesion. World units. */
  neighbourRadius: number;
  /**
   * Half-angle of the forward field of view, in radians. Neighbours outside it
   * are ignored, which is what stops the flock collapsing into a uniform ball.
   */
  fieldOfView: number;

  separationWeight: number;
  alignmentWeight: number;
  cohesionWeight: number;

  /** Weak pull toward the origin, so the flock migrates but never escapes. */
  originPull: number;

  minSpeed: number;
  maxSpeed: number;
  /** Radians per second. Caps how sharply a boid can turn. */
  maxTurnRate: number;

  /** Cursor force: positive attracts, negative repels. */
  cursorStrength: number;
  /** World units. Outside this radius the cursor has no effect. */
  cursorRadius: number;
}

/**
 * Starting point, not an answer. Real values come out of step 7a, where they
 * are found by watching the thing rather than reasoning about it.
 */
export const DEFAULT_SIM_PARAMS: Readonly<SimParams> = Object.freeze({
  count: 5000,

  separationRadius: 6,
  neighbourRadius: 24,
  fieldOfView: (Math.PI * 2) / 3,

  separationWeight: 1.5,
  alignmentWeight: 1,
  cohesionWeight: 0.8,

  originPull: 0.02,

  minSpeed: 20,
  maxSpeed: 60,
  maxTurnRate: Math.PI * 1.5,

  cursorStrength: -6,
  cursorRadius: 90,
});
