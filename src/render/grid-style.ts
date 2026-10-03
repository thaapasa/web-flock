/**
 * Everything adjustable about how the grid looks.
 *
 * Lengths are in CSS pixels, so the grid keeps its density on a Retina
 * display. `grid.ts` converts to device pixels once.
 */

import type { RGB } from './colour';

/** Shape of a decade's brightness ramp as its lines spread apart on screen.
 * All four run from 0 to 1, which is what keeps the handover continuous. */
export type FadeCurve = 'linear' | 'smooth' | 'late' | 'early';

export const FADE_CURVES: Record<FadeCurve, (t: number) => number> = {
  linear: (t) => t,
  smooth: (t) => t * t * (3 - 2 * t),
  late: (t) => t * t,
  early: (t) => 1 - (1 - t) * (1 - t),
};

export type OriginMarker = 'none' | 'ring' | 'dot' | 'cross';

export const ORIGIN_MARKER_CODES: Record<OriginMarker, number> = {
  none: 0,
  ring: 1,
  dot: 2,
  cross: 3,
};

export interface GridStyle {
  /** CSS pixels between lines where a decade first emerges from black, at
   * weight 0. */
  readonly minPixelSpacing: number;

  /**
   * Decades of spacing a band takes to reach full brightness, and so how many
   * bands are on screen at less than full strength at once. Above
   * `MAX_BANDS` - 1 the ramp is clipped, so keep it at 4 or below.
   */
  readonly fadeDecades: number;

  readonly fadeCurve: FadeCurve;

  /** CSS pixels. Below 1 the line is drawn dimmer rather than thinner. */
  readonly lineWidth: number;
  /** The grid's only colour. The axes and the origin share it. */
  readonly lineColor: RGB;
  /** Brightness of a fully faded-in line, 0..1. */
  readonly brightness: number;

  /**
   * How much brighter the axes are than the brightest line on screen: a
   * multiplier on that line's weight, not a brightness. 1 hides them as axes.
   *
   * It multiplies a value the display reads as sRGB, so the light it emits
   * climbs by roughly the multiplier to the power of 2.2. 1.08 is the fifth of
   * a stop it looks like; 1.3 is nearly twice the light.
   */
  readonly axisBoost: number;

  readonly origin: OriginMarker;
  /** CSS pixels: ring/dot radius, or the length of a cross's arms. */
  readonly originRadius: number;
  /** As `axisBoost`, for the origin marker. */
  readonly originBoost: number;

  /** As `axisBoost`, for the ring that shows how far the cursor force reaches. */
  readonly cursorBoost: number;
}

const CYAN: RGB = [0.55, 0.85, 1.0];

export const GRID_STYLE: Readonly<GridStyle> = Object.freeze({
  minPixelSpacing: 24,
  fadeDecades: 2,
  fadeCurve: 'smooth',

  lineWidth: 1,
  lineColor: CYAN,
  brightness: 0.55,

  axisBoost: 1.08,

  origin: 'none',
  originRadius: 4,
  originBoost: 1.5,

  cursorBoost: 1.15,
} satisfies GridStyle);
