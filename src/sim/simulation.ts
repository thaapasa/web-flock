import type { Vec2 } from '../math/types';
import type { SimParams } from './params';

/**
 * A few hundred boids, so the camera can frame the flock without anyone
 * scanning every boid. Positions are `[x0, y0, x1, y1, ...]` for `count` boids.
 */
export interface FlockSample {
  readonly positions: Float32Array;
  readonly count: number;
  /** Mean of the sample, not of the flock: every backend can afford that one. */
  readonly centroid: Readonly<Vec2>;
}

/**
 * The bands the renderer maps its colour ramps across. A style says where in a
 * band its ramp starts and ends, as a fraction, so retuning the flock changes
 * what the colours mean without changing a style.
 *
 * Valid after `step`, and the same object is reused across steps.
 */
export interface FlockRanges {
  /** World units per second. The flock is held between these two exactly. */
  readonly minSpeed: number;
  readonly maxSpeed: number;
  /**
   * Neighbour count near the top of the flock's spread, never below 1. No
   * parameter says how crowded a flock gets, so this is estimated and smoothed.
   * It is a soft top: a boid above it sits at the end of the ramp.
   */
  readonly maxDensity: number;
}

export interface SimInput {
  /** Cursor position in world space, or null when it is not over the canvas. */
  cursor: Readonly<Vec2> | null;
}

export interface Simulation {
  readonly capacity: number;

  /** Boids simulated on the last step. Follows `params.count`. */
  readonly count: number;

  /**
   * World positions, `[x0, y0, x1, y1, ...]`, allocated for `capacity` boids
   * with only the first `count` pairs live. Boid `i` is at index `i` here, in
   * `velocities` and in `densities`.
   *
   * These three arrays are the simulation's. A caller may hold the references
   * across steps but must never write to them.
   */
  readonly positions: Float32Array;

  /** World velocities in units per second, packed like `positions`. */
  readonly velocities: Float32Array;

  /**
   * Neighbours within `params.neighbourRadius`, one raw count per boid.
   *
   * Counted in every direction rather than through the field of view. A boid
   * feels a crowd from every side, and a density that dropped when it turned
   * would read as flicker.
   *
   * Describes the neighbourhood the step was computed from, so it lags
   * `positions` by one step. Closing the gap would mean a second neighbour pass.
   */
  readonly densities: Float32Array;

  /**
   * Bumped whenever the per-boid arrays change, so a consumer can skip work
   * when nothing has moved. Opaque: compare it for equality, nothing else.
   */
  readonly revision: number;

  /**
   * Advances by `dt` seconds. `dt` is a fixed timestep from a real-time
   * accumulator, so an implementation may assume it is small and constant.
   */
  step(dt: number, input: SimInput): void;

  /**
   * Replaces the live parameters, in effect on the next step. The caller keeps
   * the object; implementations copy what they need.
   *
   * Raising `count` adds boids to the flock that is already flying. Lowering it
   * removes them. Neither restarts anything.
   */
  setParams(params: Readonly<SimParams>): void;

  /**
   * Returns the flock to a starting state derived from `seed`. The same seed
   * must give the same starting state, so two parameter sets can be compared
   * against identical initial conditions rather than against luck.
   */
  reset(seed: number): void;

  /** Valid after `step`, and the same object is reused across steps. */
  readonly sample: FlockSample;

  /** Valid after `step`, and the same object is reused across steps. */
  readonly ranges: FlockRanges;
}

export interface SimulationOptions {
  /** Upper bound on boid count. Arrays are sized for this once, at creation. */
  capacity: number;
  params: Readonly<SimParams>;
  seed: number;
  /** How many boids `sample` holds. Defaults to 256. */
  sampleSize?: number;
}

export type SimulationFactory = (options: SimulationOptions) => Simulation;
