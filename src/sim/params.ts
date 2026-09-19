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
   *
   * Applies to alignment and cohesion only. Separation stays omnidirectional:
   * you feel a crowd pressing on you from behind whether or not you can see it,
   * and a blind spot in the rule that prevents collisions reads as a bug.
   */
  fieldOfView: number;

  separationWeight: number;
  alignmentWeight: number;
  cohesionWeight: number;
  /**
   * Cap on the combined steering acceleration of the three rules above, in
   * world units per second squared.
   *
   * It is what makes the three weights a *ratio* rather than three unbounded
   * numbers. Without it, raising one weight both changes the balance between
   * the rules and makes every boid snap harder, so no slider does one legible
   * thing. External forces — origin pull, cursor, wander — are added after this
   * cap, so the cursor can always overpower flocking.
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
   * found equilibrium from freezing into a lattice. Drawn from a per-boid
   * stream, so it is jitter rather than a shared nudge, and it is still exactly
   * reproducible from the seed.
   */
  wanderStrength: number;
  /** How fast a boid's wander direction drifts, in radians per second. */
  wanderRate: number;

  /** Cursor force: positive attracts, negative repels. */
  cursorStrength: number;
  /** World units. Outside this radius the cursor has no effect. */
  cursorRadius: number;

  /** Radius of the disc the seeded starting flock is scattered over. */
  spawnRadius: number;
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
  maxForce: 120,

  originPull: 0.02,

  minSpeed: 20,
  maxSpeed: 60,
  maxTurnRate: Math.PI * 1.5,

  wanderStrength: 8,
  wanderRate: 2,

  cursorStrength: -500,
  cursorRadius: 90,

  spawnRadius: 400,
});
