import type { FlockSample } from '../sim/simulation';

/**
 * Putting the flock on screen, once.
 *
 * Step 5 asked for a wheel that adjusts a framing percentage rather than a raw
 * zoom — how much room the flock gets, recomputed from how far it
 * currently spreads. That was built and taken out again, and the reason is
 * worth keeping: **a zoom derived from a live measurement hunts.** The flock's
 * reach moves a little every step, so the scale moved a little every frame, and
 * a grid whose whole job is to make a change of scale something you watch
 * happen turned that into a permanent shimmer. Nothing was wrong with the
 * measurement; it was the derivation running continuously that could not work.
 *
 * So zoom is a number the camera holds until something changes it, and the
 * measurement is a one-shot: {@link fitLogScale} answers "what zoom would frame
 * the flock right now", and only a keypress or a button ever asks.
 *
 * Step 6 is where a continuously derived zoom becomes possible, because that is
 * where the hysteresis and the damping live — a tolerance band the flock moves
 * freely inside, so the camera holds still until it has genuinely outgrown the
 * frame. The parts that survive to feed it are here already: the quantile, the
 * reach, and the fit.
 */

/**
 * Hard limits on zoom, as log10 CSS pixels per world unit.
 *
 * They bound the wheel and they stop a degenerate flock producing a degenerate
 * camera: one collapsed to a point has a reach near zero and would otherwise
 * ask {@link fitLogScale} for infinite magnification.
 */
export const MIN_LOG_SCALE = -3;
export const MAX_LOG_SCALE = 3;

/**
 * Fraction of the flock a fit is measured against.
 *
 * Step 6's robust framing, and already step 4b's: the tightest region holding
 * most of the flock, so a single straggler halfway to the horizon cannot force
 * a zoom-out. Step 6 adds the damping and the hysteresis around it; the
 * quantile itself is the same number either way.
 */
export const FRAME_QUANTILE = 0.85;

/**
 * Room left around the flock by a fit.
 *
 * A flock that exactly touches the edges looks like it is about to escape even
 * when it is not.
 */
const FIT_MARGIN = 1.25;

/** Smallest reach a fit will believe. See {@link MIN_LOG_SCALE}. */
const MIN_REACH = 1e-3;

/**
 * Radius of the tightest disc about the sample's centroid holding `quantile`
 * of it, in world units. 0 for an empty flock.
 *
 * `scratch` must hold at least `sample.count` elements and is overwritten; the
 * caller owns it so that a fit allocates nothing.
 */
export function flockReach(sample: FlockSample, quantile: number, scratch: Float64Array): number {
  const { positions, count, centroid } = sample;
  if (count === 0) return 0;

  const radii = scratch.subarray(0, count);
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 2] - centroid.x;
    const dy = positions[i * 2 + 1] - centroid.y;
    radii[i] = Math.sqrt(dx * dx + dy * dy);
  }
  // A typed array sorts numerically by default, which is the one place this
  // differs from sorting a plain array of numbers.
  radii.sort();

  return radii[Math.floor((count - 1) * clamp(quantile, 0, 1))];
}

/**
 * The zoom that puts a flock of this reach on screen, as log10 CSS pixels per
 * world unit. Measured against the viewport's shorter dimension, so it frames
 * the flock however the window is shaped.
 *
 * Clamped, so the caller can hand this straight to `camera.logScale`.
 */
export function fitLogScale(reach: number, viewportWidth: number, viewportHeight: number): number {
  const half = Math.min(viewportWidth, viewportHeight) / 2;
  return clamp(Math.log10(half / (Math.max(reach, MIN_REACH) * FIT_MARGIN)));
}

/**
 * Moves the zoom by a number of decades.
 *
 * Additive because the camera holds zoom as a logarithm: a decade is the same
 * sized step wherever in the range it is taken, which is what makes the wheel
 * feel even rather than accelerating.
 */
export function stepZoom(logScale: number, decades: number): number {
  return clamp(logScale + decades);
}

function clamp(value: number, low = MIN_LOG_SCALE, high = MAX_LOG_SCALE): number {
  return Math.min(high, Math.max(low, value));
}
