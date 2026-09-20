import type { Vec2 } from '../math/types';
import type { SimParams } from './params';

/**
 * The seam between the simulation and everything else.
 *
 * Iteration one simulates on the CPU over typed arrays. A GPU backend should
 * later be able to replace it without rendering or UI noticing. Three rules
 * keep that possible, and they are the reason this file looks the way it does:
 *
 * 1. **A simulation computes; it does not draw.** There is no GL here. The
 *    thing worth designing against is not the absence of a context, it is
 *    forcing the path to the GPU through a typed array: a GPU backend that had
 *    to hand back a `Float32Array` would read its own results off the GPU every
 *    frame, only for the renderer to upload them straight back. That readback
 *    is what turns a drop-in into a rewrite.
 *
 *    So the contract is split. This interface exposes CPU-side arrays, which is
 *    the natural shape for a CPU backend. Getting per-boid data onto the GPU is
 *    a separate interface, `BoidFeed` in `render/`, and it is the *renderer's*
 *    concern. A CPU backend gets an uploading feed wrapped around it; a GPU
 *    backend implements both and its feed hands over the buffer it just
 *    computed into, with nothing copied and nothing read back.
 *
 * 2. **Parameters go in as plain data** ({@link SimParams}), never as callbacks
 *    or objects with behaviour. Plain data is equally natural as JavaScript
 *    fields or as a uniform block.
 *
 * 3. **Whatever the rest of the program needs to summarise the flock comes
 *    from the backend** — {@link FlockSample} for the camera, {@link FlockRanges}
 *    for the renderer's colour ramps — because only the backend knows what it
 *    can afford to produce. Nobody else scans the full flock.
 *
 * Nothing here says where the arithmetic happens. That is the point.
 */

/**
 * A small CPU-side sample of the flock, refreshed by the backend on each step.
 *
 * This exists so the camera can frame the flock without anyone scanning every
 * boid. Step 6 wants the tightest region holding roughly 85% of the flock,
 * which is a quantile rather than a mean — a few hundred boids are plenty to
 * estimate one, and are cheap enough for a GPU backend to read back while the
 * full set would not be.
 *
 * Positions are `[x0, y0, x1, y1, ...]` for `count` boids.
 */
export interface FlockSample {
  readonly positions: Float32Array;
  readonly count: number;
  /**
   * Mean position **of the sample**, not of the flock. Deliberately: it is what
   * every backend can afford, so the camera behaves the same behind all of
   * them. The few percent of jitter this costs is well inside what step 6's
   * damping absorbs.
   */
  readonly centroid: Readonly<Vec2>;
}

/**
 * The bands the renderer maps its colour ramps across.
 *
 * Here for the same reason {@link FlockSample} is: only the backend knows what
 * its own numbers look like, and a renderer that guessed would be wrong the
 * moment anything was tuned. A style says *where in the band* its ramp starts
 * and ends, as a fraction, and the band itself moves with the flock — so
 * retuning speed in 7a, or dragging the count slider in 4b, changes what the
 * colours mean without changing a single style.
 *
 * Speed is exact: the flock is held between these two by construction.
 * {@link maxDensity} cannot be, because there is no parameter that says how
 * crowded a flock gets — it falls out of the count, the neighbour radius and
 * how tightly the rules pack them. So it is estimated and smoothed, and it is
 * a soft top rather than a maximum: boids above it sit at the end of the ramp.
 *
 * Valid after {@link Simulation.step}; the same object is reused across steps.
 */
export interface FlockRanges {
  /** World units per second. */
  readonly minSpeed: number;
  readonly maxSpeed: number;
  /** Neighbour count near the top of the flock's spread. Never below 1. */
  readonly maxDensity: number;
}

/** Per-step inputs that are not parameters: things that change every frame. */
export interface SimInput {
  /** Cursor position in world space, or null when it is not over the canvas. */
  cursor: Readonly<Vec2> | null;
}

export interface Simulation {
  /** The largest `params.count` this backend will honour. */
  readonly capacity: number;

  /** Boids actually simulated on the last step. Follows `params.count`. */
  readonly count: number;

  /**
   * World positions, `[x0, y0, x1, y1, ...]`, tightly packed. Allocated for
   * `capacity` boids; only the first `count` pairs are live. Boid `i` is at
   * index `i` here and in {@link velocities}.
   *
   * The array itself is stable across steps — a consumer may hold the reference
   * — but the contents are the simulation's and must not be written to.
   */
  readonly positions: Float32Array;

  /**
   * World velocities in units per second, packed like {@link positions}. Part
   * of the contract rather than an internal detail because the renderer needs
   * it for the chevron's heading.
   */
  readonly velocities: Float32Array;

  /**
   * Neighbours within `params.neighbourRadius`, one count per boid, packed
   * like {@link positions} but one element each.
   *
   * Here because how crowded a boid is turns out to be the most useful thing
   * to colour it by, and only the simulation can say — the renderer would have
   * to build a second neighbour index to find out. Counted **omnidirectionally**
   * rather than through the field of view: a crowd presses on you from every
   * side, and a density that dropped when a boid turned would read as flicker.
   *
   * A raw count, not a fraction. Which range of counts maps to which colours is
   * a taste call and belongs to the style, not to the simulation.
   *
   * Describes the neighbourhood the step was *computed from*, so it lags
   * {@link positions} by one integration. Nothing that matters at a boid's
   * speed, and closing the gap would mean a second neighbour pass.
   */
  readonly densities: Float32Array;

  /**
   * Bumped whenever the per-boid arrays change, so a consumer can skip work
   * when nothing has moved. Opaque: compare it for equality, do not do
   * arithmetic on it.
   */
  readonly revision: number;

  /**
   * Advances by exactly `dt` seconds.
   *
   * `dt` is a **fixed** timestep, supplied by a real-time accumulator rather
   * than measured from the frame. Behaviour then does not change with
   * framerate, and a frame hitch cannot fling boids across the world — it
   * produces several steps of the usual size instead of one enormous one.
   * Implementations may assume `dt` is small and constant.
   */
  step(dt: number, input: SimInput): void;

  /**
   * Replaces the live parameters. Takes effect on the next {@link step}, with
   * no restart. The caller keeps ownership of the object; implementations copy
   * what they need rather than holding the reference.
   *
   * Raising `count` adds boids to the flock that is already running; it is not
   * a restart. Lowering it removes them.
   */
  setParams(params: Readonly<SimParams>): void;

  /**
   * Returns the flock to a starting state derived from `seed`. The same seed
   * must give the same starting state, so that two parameter sets can be
   * compared against identical initial conditions rather than against luck.
   */
  reset(seed: number): void;

  /** Valid after {@link step}; the same object is reused across steps. */
  readonly sample: FlockSample;

  /** Valid after {@link step}; the same object is reused across steps. */
  readonly ranges: FlockRanges;
}

export interface SimulationOptions {
  /** Upper bound on boid count. Arrays are sized for this once, at creation. */
  capacity: number;
  params: Readonly<SimParams>;
  seed: number;
  /** How many boids {@link FlockSample} holds. Defaults to 256. */
  sampleSize?: number;
}

export type SimulationFactory = (options: SimulationOptions) => Simulation;
