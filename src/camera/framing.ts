import type { FlockSample } from '../sim/simulation';

/**
 * The camera holds zoom as a number until something changes it. A zoom derived
 * continuously from the flock's spread hunts, because the flock's reach moves
 * every step, so `fitLogScale` is a one-shot answer that only a keypress or a
 * button asks for.
 */

/** Zoom limits, as log10 CSS pixels per world unit. */
export const MIN_LOG_SCALE = -3;
export const MAX_LOG_SCALE = 3;

/** A fit frames this fraction of the flock, so one straggler cannot force a zoom-out. */
export const FRAME_QUANTILE = 0.85;

/** A fit leaves this much room around the flock, as a multiple of its reach. */
const FIT_MARGIN = 1.25;

/** Floor on reach, in world units. A collapsed flock would otherwise ask for infinite zoom. */
const MIN_REACH = 1e-3;

/**
 * Radius of the tightest disc about the sample's centroid holding `quantile`
 * of it, in world units. 0 for an empty flock.
 *
 * `scratch` must hold at least `sample.count` elements and is overwritten. The
 * caller owns it, so a fit allocates nothing.
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
  // A typed array sorts numerically, unlike a plain array of numbers.
  radii.sort();

  return radii[Math.floor((count - 1) * clamp(quantile, 0, 1))];
}

/**
 * The zoom that puts a flock of this reach on screen, as log10 CSS pixels per
 * world unit. Measured against the viewport's shorter dimension, and clamped,
 * so the caller can hand it straight to `camera.logScale`.
 */
export function fitLogScale(reach: number, viewportWidth: number, viewportHeight: number): number {
  const half = Math.min(viewportWidth, viewportHeight) / 2;
  return clamp(Math.log10(half / (Math.max(reach, MIN_REACH) * FIT_MARGIN)));
}

/** Moves the zoom by a number of decades. Additive because zoom is a logarithm. */
export function stepZoom(logScale: number, decades: number): number {
  return clamp(logScale + decades);
}

function clamp(value: number, low = MIN_LOG_SCALE, high = MAX_LOG_SCALE): number {
  return Math.min(high, Math.max(low, value));
}
