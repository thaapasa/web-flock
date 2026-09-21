import type { FlockSample } from '../sim/simulation';

/**
 * Turning a flock into a camera: how big the flock is, what zoom frames it,
 * and how a zoom that tracks it moves without hunting.
 */

/** Zoom limits, as log10 CSS pixels per world unit. */
export const MIN_LOG_SCALE = -3;
export const MAX_LOG_SCALE = 3;

/**
 * A fit measures the flock across this fraction of it, so one straggler cannot
 * drag the camera. Not a zoom control: `frameLog` is that.
 */
export const FRAME_QUANTILE = 0.85;

/**
 * Follow-zoom limits, as log10 of the fraction of the flock's size framed. 0
 * is a plain fit, -2 puts you inside the core and +2 leaves the flock a speck.
 */
export const MIN_FRAME_LOG = -2;
export const MAX_FRAME_LOG = 2;

/**
 * Tops of the two knobs the follow zoom is tuned with. A tolerance of a third
 * of a decade already holds through most of a grid handover, and four seconds
 * is slower than anyone watches.
 */
export const MAX_ZOOM_TOLERANCE = 0.3;
export const MAX_ZOOM_TAU = 4;

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
  return clamp(rawFit(reach, viewportWidth, viewportHeight));
}

/**
 * The zoom a following camera wants: a fit, moved out by `frameLog` decades.
 *
 * Zoom is a logarithm and so is the frame fraction, so the two subtract. That
 * is why the wheel feels the same in both modes: a notch is the same number of
 * decades whichever of the two it moves.
 */
export function followLogScale(
  reach: number,
  viewportWidth: number,
  viewportHeight: number,
  frameLog: number,
): number {
  return clamp(rawFit(reach, viewportWidth, viewportHeight) - frameLog);
}

/**
 * Moves `current` toward `target`, but only the distance past `tolerance`, and
 * only as fast as the time constant `tau` allows.
 *
 * Pulling the excess rather than the whole error is what stops the camera
 * hunting. It comes to rest one tolerance short of the target, so a flock
 * breathing inside the band moves the camera not at all, and a flock that keeps
 * growing pushes the band along ahead of it.
 *
 * Exact for any `dt`: ten short steps land where one long step lands, so the
 * feel does not change with the framerate.
 */
export function approach(
  current: number,
  target: number,
  tolerance: number,
  tau: number,
  dt: number,
): number {
  if (dt <= 0) return current;

  const error = target - current;
  const excess = Math.abs(error) - Math.max(0, tolerance);
  if (excess <= 0) return current;

  const step = tau > 0 ? excess * -Math.expm1(-dt / tau) : excess;
  return error > 0 ? current + step : current - step;
}

/** Moves the zoom by a number of decades. Additive because zoom is a logarithm. */
export function stepZoom(logScale: number, decades: number): number {
  return clamp(logScale + decades);
}

/** Moves the frame fraction by a number of decades, the same way. */
export function stepFrame(frameLog: number, decades: number): number {
  return clamp(frameLog + decades, MIN_FRAME_LOG, MAX_FRAME_LOG);
}

function rawFit(reach: number, viewportWidth: number, viewportHeight: number): number {
  const half = Math.min(viewportWidth, viewportHeight) / 2;
  return Math.log10(half / (Math.max(reach, MIN_REACH) * FIT_MARGIN));
}

function clamp(value: number, low = MIN_LOG_SCALE, high = MAX_LOG_SCALE): number {
  return Math.min(high, Math.max(low, value));
}
