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

  /**
   * The ring that shows how far the cursor force reaches, and its pulses. Full
   * colours rather than boosts on the grid's: the two forces have to look
   * different from each other and from the grid.
   *
   * Red-orange against pale cyan, rather than red against green, so the pair
   * still differs in lightness and warmth for red-green colour blindness.
   */
  readonly repelColour: RGB;
  readonly attractColour: RGB;
  /**
   * Seconds a pulse takes to cross from the cursor to the ring, or back, when
   * the force is `pulseStrength`. See `pulseRate`.
   */
  readonly pulseTravel: number;
  readonly pulseStrength: number;
  /** Pulses crossing at once, spread evenly through one crossing. */
  readonly pulseCount: number;
  /** A pulse's brightness at its peak, as a fraction of the ring's. */
  readonly pulseBrightness: number;
}

const CYAN: RGB = [0.55, 0.85, 1.0];
const RED_ORANGE: RGB = [1.0, 0.38, 0.22];
const PALE_CYAN: RGB = [0.62, 0.86, 0.95];

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

  repelColour: RED_ORANGE,
  attractColour: PALE_CYAN,
  pulseTravel: 1.6,
  pulseStrength: 500,
  pulseCount: 2,
  pulseBrightness: 0.5,
} satisfies GridStyle);

/**
 * Crossings per second for a cursor force of the given magnitude, so a
 * stronger force pulses faster.
 *
 * By the square root of the strength, because the slider spans a factor of
 * 200: in proportion, the weak end would barely move and the strong end would
 * flicker.
 */
export function pulseRate(style: Readonly<GridStyle>, strength: number): number {
  return Math.sqrt(Math.max(0, strength) / style.pulseStrength) / style.pulseTravel;
}
