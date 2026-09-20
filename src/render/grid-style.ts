/**
 * Everything adjustable about how the grid looks.
 *
 * The grid is the signature feature, and which of these values are right is a
 * question for the eye rather than for reasoning — see step 3 in PLAN.md. So
 * this file's job is to make the taste calls *reachable*: every one of them is
 * a named field with a range, the presets sit on number keys, and comparison
 * mode puts four of them on screen at once.
 *
 * **One colour, one width, brightness for everything else.** The axes and the
 * origin are not special marks with their own palette — they are ordinary
 * decade lines turned up slightly, because the origin of an unbounded plane
 * that the flock wanders away from carries no meaning worth a heavier mark.
 * That is why `axisBoost` is a multiplier rather than a brightness: it can
 * only say "a bit more than a line at full strength", never "a different
 * thing".
 *
 * Lengths are in **CSS pixels**, so the grid looks the same density on a
 * Retina display as on a 1x one. The conversion to device pixels happens once,
 * in `grid.ts`.
 */

/** Linear, 0..1 per channel. Not gamma-corrected; these are shader values. */
export type RGB = readonly [r: number, g: number, b: number];

/**
 * Shape of a decade's brightness ramp as its lines spread apart on screen.
 *
 * All four start at 0 and end at 1, which is what keeps the handover
 * continuous — see `grid-bands.ts`. They differ only in what happens between,
 * and that difference is the whole feel of the fade: `late` keeps new lines
 * faint until they have real room and then brings them up quickly, `early`
 * does the opposite.
 */
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
  /** Shown in comparison mode and in the readout. */
  readonly name: string;

  /**
   * CSS pixels between lines at which a decade first emerges from black.
   * Higher means fewer lines on screen before the next decade takes over.
   */
  readonly minPixelSpacing: number;

  /**
   * How many decades of spacing a decade takes to reach full brightness —
   * in other words, how many decades are visible at once at anything less
   * than full strength, and therefore how much hierarchy there is between
   * coarse and fine lines.
   *
   * It is also the main control over how *visible* the lines on screen are,
   * which is not the same question as how many there are: a short ramp brings
   * a new decade up to strength quickly, a long one leaves most of what is on
   * screen faint. Above {@link MAX_BANDS} - 1 the ramp is clipped, so keep it
   * at 4 or below.
   */
  readonly fadeDecades: number;

  readonly fadeCurve: FadeCurve;

  /** CSS pixels. Below 1 the line is drawn dimmer rather than thinner. */
  readonly lineWidth: number;
  /** The grid's only colour. Axes and origin share it. */
  readonly lineColor: RGB;
  /** Brightness of a fully faded-in line, 0..1. */
  readonly brightness: number;

  /**
   * How much brighter the x and y axes are than a decade line at full
   * strength. 1 makes them invisible as axes; much above 1.5 and the origin
   * starts to look like it means something.
   */
  readonly axisBoost: number;

  readonly origin: OriginMarker;
  /** CSS pixels: ring/dot radius, or the length of a cross's arms. */
  readonly originRadius: number;
  /** As {@link axisBoost}, for the origin marker. */
  readonly originBoost: number;
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

    ...overrides,
  } satisfies GridStyle);
}

/**
 * Bound to the number keys, and the pool comparison mode draws from.
 *
 * **1 is the settled look**, chosen by eye in step 3: lines that stay well
 * apart, a two-decade ramp, and axes that barely announce themselves. It is
 * the default, and the rest of the list exists to be compared against it —
 * `even` a little denser, `rise` and `strong` two different ways of making the
 * lines on screen more present, then wider swings in spacing, hierarchy and
 * weight. Step 7b revisits all of this against the finished renderer, which is
 * why none of them are deleted now that one has won.
 */
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

/** What loads on a cold start. */
export const DEFAULT_GRID_STYLE = GRID_PRESETS[0];
