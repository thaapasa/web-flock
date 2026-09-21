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
  readonly name: string;

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

  /** How much brighter the axes are than a decade line at full strength: a
   * multiplier on `brightness`, not a brightness. 1 hides them as axes. */
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

function preset(overrides: Partial<GridStyle> & { name: string }): Readonly<GridStyle> {
  return Object.freeze({
    minPixelSpacing: 18,
    fadeDecades: 2,
    fadeCurve: 'smooth',

    lineWidth: 1,
    lineColor: CYAN,
    brightness: 0.55,

    axisBoost: 1.3,

    origin: 'none',
    originRadius: 4,
    originBoost: 1.5,

    cursorBoost: 1.15,

    ...overrides,
  } satisfies GridStyle);
}

/** Bound to the number keys, and the pool comparison mode draws from. Each
 * preset after the first changes one thing. */
export const GRID_PRESETS: readonly Readonly<GridStyle>[] = Object.freeze([
  preset({ name: 'open', minPixelSpacing: 24 }),

  preset({ name: 'even', minPixelSpacing: 18, fadeDecades: 1.7, brightness: 0.58 }),
  preset({ name: 'rise', minPixelSpacing: 24, fadeDecades: 1.3 }),
  preset({ name: 'strong', minPixelSpacing: 24, brightness: 0.75 }),
  preset({ name: 'dense', minPixelSpacing: 12, brightness: 0.5 }),
  preset({ name: 'deep', fadeDecades: 3, fadeCurve: 'late', brightness: 0.65 }),
  preset({ name: 'flat', fadeDecades: 1, fadeCurve: 'early', brightness: 0.5 }),
  preset({ name: 'hairline', lineWidth: 0.7, brightness: 0.8 }),
  preset({ name: 'bold', lineWidth: 1.5, brightness: 0.45 }),
]);

export const DEFAULT_GRID_STYLE = GRID_PRESETS[0];
