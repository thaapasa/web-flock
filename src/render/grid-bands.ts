import type { FadeCurve, GridStyle } from './grid-style';
import { FADE_CURVES } from './grid-style';

/**
 * Which decades of grid spacing are on screen, and how bright each one is.
 *
 * A decade's weight depends only on how far apart its lines are on screen. A
 * line belongs to several decades at once, so the shader takes the maximum
 * weight over them rather than the sum. Each line then draws at the weight of
 * the coarsest decade it belongs to, and no crossing goes brighter than 1.
 *
 * Nothing pops at a handover, because a decade enters the set at weight 0 and
 * leaves only once its weight has saturated at 1, by which point the decade
 * above draws the same line just as brightly.
 */

/** Decades evaluated per pixel. `grid.ts` injects it into the shader so the
 * two cannot drift. */
export const MAX_BANDS = 5;

export interface GridBand {
  /** Lines are `10 ** exponent` world units apart. */
  exponent: number;
  /** Pixels between lines, in the unit the caller passed in. */
  spacing: number;
  /** Brightness, 0..1. */
  weight: number;
}

export function createBands(): GridBand[] {
  return Array.from({ length: MAX_BANDS }, () => ({ exponent: 0, spacing: 0, weight: 0 }));
}

/** One more decade than the ramp is long, which is exactly enough for the top
 * band to have saturated. */
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
 * `style.minPixelSpacing`: CSS pixels.
 */
export function computeBands(
  pixelsPerUnit: number,
  style: Readonly<GridStyle>,
  out: GridBand[],
): number {
  const { minPixelSpacing, fadeDecades, fadeCurve } = style;
  const count = bandCount(fadeDecades);

  // The finest decade whose lines are at least `minPixelSpacing` apart. Ceil,
  // so the finest band starts at weight 0 and climbs.
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
 * Reduced here in float64, never in the shader: the flock migrates, so
 * `centre` can reach six or seven figures, and `centre * pixelsPerUnit` in
 * float32 would quantise to whole pixels or worse. What crosses into the
 * shader is always within half a line spacing of zero.
 */
export function bandPhase(centre: number, exponent: number, pixelsPerUnit: number): number {
  const spacing = 10 ** exponent;
  return (centre - spacing * Math.round(centre / spacing)) * pixelsPerUnit;
}

/** The brightness the grid gives a line at world coordinate `value`: what the
 * shader does per pixel, in a form the tests can sweep. */
export function lineBrightness(value: number, bands: readonly GridBand[], count: number): number {
  let best = 0;
  for (let i = 0; i < count; i++) {
    const band = bands[i];
    const spacing = 10 ** band.exponent;
    const offset = Math.abs(value - spacing * Math.round(value / spacing));
    // The tolerance scales with `value`, not with `spacing`: testing a coarse
    // line against a fine decade divides two numbers many orders of magnitude
    // apart, and the float error comes back relative to the larger.
    if (offset <= Math.abs(value) * 1e-9) best = Math.max(best, band.weight);
  }
  return best;
}
