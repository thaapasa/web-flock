import type { Vec2 } from '../math/types';
import type { SimParams } from './params';

/**
 * The seam between simulation and everything else.
 *
 * Iteration one simulates on the CPU over typed arrays. A GPU backend should
 * later be able to replace it without rendering or UI noticing. Three rules
 * keep that possible, and they are the reason this file looks the way it does:
 *
 * 1. **The backend owns the boid data, and exposes it as GL buffers rather
 *    than as typed arrays.** A CPU backend uploads its arrays once per step; a
 *    GPU backend hands over the buffer it just computed into and uploads
 *    nothing. If this interface returned a `Float32Array`, a GPU backend would
 *    have to read data back off the GPU every frame purely to satisfy the
 *    interface — which is the specific mistake that turns a drop-in into a
 *    rewrite.
 *
 * 2. **Parameters go in as plain data** ({@link SimParams}), never as
 *    callbacks or objects with behaviour. Plain data is equally natural as
 *    JavaScript fields or as a uniform block.
 *
 * 3. **Whatever the camera needs to aim itself comes from the backend**, via
 *    {@link FlockSample}, because only the backend knows where the data
 *    physically lives. The camera never touches boid buffers directly.
 *
 * Nothing here says where the arithmetic happens. That is the point.
 */

/** Describes one per-instance attribute well enough for the renderer to bind it. */
export interface VertexAttributeSource {
  readonly buffer: WebGLBuffer;
  /** Components per boid. */
  readonly size: 1 | 2 | 3 | 4;
  /** A `gl.*` type enum, e.g. `gl.FLOAT`. */
  readonly type: number;
  /** Bytes between consecutive boids. 0 means tightly packed. */
  readonly stride: number;
  /** Byte offset of boid 0. */
  readonly offset: number;
}

/**
 * The buffers the renderer binds, one element per boid, boid `i` at index `i`
 * in every one of them.
 *
 * Contents are valid after {@link Simulation.step} returns and until the next
 * call to it. The renderer must not write to them.
 *
 * Trails are deliberately absent. Whether a trail is a ring buffer of past
 * positions or a quad stretched along the velocity is decided in step 4a, and
 * either way it is the renderer's business: a history of positions can be
 * accumulated renderer-side by copying `position` into a ring of buffers with
 * `copyBufferSubData`, which costs the same for both backends and keeps this
 * interface from having to guess.
 */
export interface SimBuffers {
  /** `vec2` world position. */
  readonly position: VertexAttributeSource;
  /**
   * `vec2` world velocity, in world units per second. The renderer needs this
   * for the chevron's heading, so it is part of the contract rather than an
   * internal detail.
   */
  readonly velocity: VertexAttributeSource;
}

/**
 * A small CPU-side sample of the flock, refreshed by the backend on each step.
 *
 * This exists so the camera can frame the flock without anyone reading the
 * full boid buffers. Step 6 wants the tightest region holding roughly 85% of
 * the flock, which is a quantile rather than a mean — a few hundred boids are
 * plenty to estimate one, and are cheap enough for a GPU backend to read back
 * while the full set would not be.
 *
 * Positions are `[x0, y0, x1, y1, ...]` for `count` boids.
 */
export interface FlockSample {
  readonly positions: Float32Array;
  readonly count: number;
  /** Mean position of the sample. Cheap, and enough on its own for early work. */
  readonly centroid: Readonly<Vec2>;
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
   */
  setParams(params: Readonly<SimParams>): void;

  /**
   * Returns the flock to a starting state derived from `seed`. The same seed
   * must give the same starting state, so that two parameter sets can be
   * compared against identical initial conditions rather than against luck.
   */
  reset(seed: number): void;

  /** Valid after {@link step}; the same objects are reused across steps. */
  readonly buffers: SimBuffers;
  readonly sample: FlockSample;

  /** Releases GL resources. The instance is unusable afterwards. */
  dispose(): void;
}

export interface SimulationOptions {
  /** Upper bound on boid count. Buffers are sized for this once, at creation. */
  capacity: number;
  params: Readonly<SimParams>;
  seed: number;
  /** How many boids {@link FlockSample} holds. Defaults to 256. */
  sampleSize?: number;
}

/**
 * How a backend is constructed. The GL context is a parameter because the
 * backend owns the buffers the renderer draws from — see rule 1 above.
 */
export type SimulationFactory = (
  gl: WebGL2RenderingContext,
  options: SimulationOptions,
) => Simulation;
