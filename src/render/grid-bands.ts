import type { FadeCurve, GridStyle } from './grid-style';
import { FADE_CURVES } from './grid-style';

/**
 * Which decades of grid spacing are on screen, and how bright each one is.
 *
 * This is the part of the grid that has to be *right* rather than merely
 * pleasant, so it lives in TypeScript where it can be tested, and the shader
 * only consumes what comes out of here.
 *
 * The rule the whole thing rests on:
 *
 * > **A line's brightness is a function of how far apart that decade's lines
 * > are on screen — nothing else.**
 *
 * Every grid line belongs to several decades at once (the line at 100 is also
 * a multiple of 10 and of 1), so the shader takes the *maximum* weight over
 * the decades a pixel falls on rather than the sum. A line therefore ends up
 * drawn at the weight of the coarsest decade it belongs to, automatically,
 * with no "which decade owns this line" test anywhere — and never brighter
 * than 1, which is what a sum would do at every intersection of scales.
 *
 * Continuity — no pop at a handover — then follows from two facts rather than
 * from tuning:
 *
 * 1. A decade enters the set exactly when its spacing reaches
 *    `minPixelSpacing`, which is where its weight is exactly 0. It fades up
 *    from black instead of appearing.
 * 2. A decade leaves the set at the coarse end only once its weight has
 *    saturated at 1, so the decade above it — which is what the shader's
 *    `max` falls back on — is already drawing it at the same brightness.
 *
 * Both are asserted in `grid-bands.test.ts` by sweeping the zoom and checking
 * that no line's brightness ever jumps.
 */

/**
 * Hard ceiling on decades evaluated per pixel. **Must match `MAX_BANDS` in the
 * grid shader**, which is why the shader source interpolates this constant
 * rather than repeating the number.
 */
export const MAX_BANDS = 5;

export interface GridBand {
  /** Lines are `10 ** exponent` world units apart. */
  exponent: number;
  /** Pixels between lines, in whatever pixel unit the caller passed in. */
  spacing: number;
  /** Brightness weight, 0..1. */
  weight: number;
}

export function createBands(): GridBand[] {
  return Array.from({ length: MAX_BANDS }, () => ({ exponent: 0, spacing: 0, weight: 0 }));
}

/**
 * How many decades need evaluating for a style.
 *
 * One more than the ramp is long, which is exactly enough for the top band to
 * have saturated: see point 2 above, and `saturates at the top band` in the
 * tests.
 */
export function bandCount(fadeDecades: number): number {
  return Math.min(MAX_BANDS, Math.max(2, Math.ceil(fadeDecades) + 1));
}

export function bandWeight(
  spacing: number,
  minPixelSpacing: number,
  fadeDecades: number,
  curve: FadeCurve,
): number {
  const t = Math.log10(spacing / minPixelSpacing) / fadeDecades;
  return FADE_CURVES[curve](Math.min(1, Math.max(0, t)));
}

/**
 * Fills `out` with the visible decades, finest first, and returns how many are
 * live. `pixelsPerUnit` and the resulting `spacing` are in the same unit as
 * `style.minPixelSpacing`, i.e. CSS pixels.
 */
export function computeBands(
  pixelsPerUnit: number,
  style: Readonly<GridStyle>,
  out: GridBand[],
): number {
  const { minPixelSpacing, fadeDecades, fadeCurve } = style;
  const count = bandCount(fadeDecades);

  // The finest decade whose lines are at least `minPixelSpacing` apart. Ceil,
  // so the finest band's weight starts at 0 and climbs: the band below this one
  // is the one that just faded out.
  const finest = Math.ceil(Math.log10(minPixelSpacing / pixelsPerUnit));

  for (let i = 0; i < count; i++) {
    const exponent = finest + i;
    const spacing = 10 ** exponent * pixelsPerUnit;
    const band = out[i];
    band.exponent = exponent;
    band.spacing = spacing;
    band.weight = bandWeight(spacing, minPixelSpacing, fadeDecades, fadeCurve);
  }
  return count;
}

/**
 * Signed distance in pixels from the camera centre to the nearest line of a
 * decade, which is the phase the shader needs.
 *
 * Reduced here, in float64, and never in the shader: the flock migrates, so
 * `centre` can reach six or seven figures, and `centre * pixelsPerUnit` as a
 * float32 would quantise to whole pixels or worse. What crosses into the
 * shader is always within half a line spacing of zero.
 */
export function bandPhase(centre: number, exponent: number, pixelsPerUnit: number): number {
  const spacing = 10 ** exponent;
  return (centre - spacing * Math.round(centre / spacing)) * pixelsPerUnit;
}

/**
 * The brightness the grid gives a line at world coordinate `value`: the
 * reference implementation of the `max`-over-decades rule the shader applies
 * per pixel, in a form the tests can sweep.
 */
export function lineBrightness(value: number, bands: readonly GridBand[], count: number): number {
  let best = 0;
  for (let i = 0; i < count; i++) {
    const band = bands[i];
    const spacing = 10 ** band.exponent;
    const offset = Math.abs(value - spacing * Math.round(value / spacing));
    // The tolerance scales with `value`, not with `spacing`: testing a coarse
    // line against a fine decade divides two numbers many orders of magnitude
    // apart, and the float error that comes back is relative to the larger.
    if (offset <= Math.abs(value) * 1e-9) best = Math.max(best, band.weight);
  }
  return best;
}
