/**
 * Everything adjustable about how a boid looks.
 *
 * Lengths are in CSS pixels unless the name says world units, so a boid keeps
 * its weight on a Retina display. `boids.ts` converts to device pixels once.
 */

import type { FlockRanges } from '../sim/simulation';
import type { RGB } from './colour';
import { MAX_TRAIL_POINTS } from './trail-history';

export type ColourInput = 'flat' | 'speed' | 'density';

export const COLOUR_INPUT_CODES: Record<ColourInput, number> = {
  flat: 0,
  speed: 1,
  density: 2,
};

/** `history` draws the path the boid took, from the recorded samples. */
export type TrailKind = 'none' | 'history';

/**
 * `boid` gives the whole trail the boid's current colour. `sampled` colours
 * each point by what was recorded there, and is the only one that needs the
 * history texture's extra channels.
 */
export type TrailColour = 'boid' | 'sampled';

export const TRAIL_COLOUR_CODES: Record<TrailColour, number> = {
  boid: 0,
  sampled: 1,
};

/** Both modes take a premultiplied fragment, so only the blend function
 * differs. */
export type BlendMode = 'additive' | 'alpha';

/**
 * The colour schemes, `[low, high]` each. Low is a slow or lonely boid, and on
 * a black background it doubles as the dim end, so no scheme starts at a
 * saturated mid-brightness colour.
 */
export const COLOUR_RAMPS = {
  ice: [
    [0.16, 0.34, 0.78],
    [0.82, 0.97, 1.0],
  ],
  amber: [
    [0.35, 0.72, 1.0],
    [1.0, 0.8, 0.42],
  ],
  mono: [
    [0.16, 0.4, 0.54],
    [0.72, 0.96, 1.0],
  ],
  ember: [
    [0.6, 0.14, 0.1],
    [1.0, 0.9, 0.55],
  ],
  signal: [
    [0.26, 0.86, 1.0],
    [1.0, 0.3, 0.42],
  ],
  flux: [
    [0.1, 0.26, 0.62],
    [0.74, 0.96, 0.36],
  ],
} as const satisfies Record<string, readonly [RGB, RGB]>;

export type ColourRamp = keyof typeof COLOUR_RAMPS;

export interface BoidStyle {
  readonly name: string;

  /** Nose-to-tail length of the chevron, in world units. */
  readonly size: number;
  /** Floor on that length in CSS pixels, so a distant flock thins into a
   * texture instead of vanishing. There is no ceiling. */
  readonly minScreenSize: number;
  /**
   * How hard a boid dims once it has hit `minScreenSize`, as an exponent on
   * how far below the floor it should have been. 0 leaves it at full
   * brightness, 1 dims with its length, 2 with its area.
   *
   * Without it, zooming out makes light: the mark stops shrinking while the
   * boids keep converging on screen, so the same brightness lands in fewer
   * pixels and additive blending sums it into a white blob.
   */
  readonly floorFade: number;
  /** Angle between an arm and the backward axis, in radians. The mark's length
   * does not change with it: the arms splay wider instead. */
  readonly halfAngle: number;
  /** Stroke width of the chevron, CSS pixels. Below 1 it draws dimmer, not thinner. */
  readonly lineWidth: number;

  readonly colourBy: ColourInput;
  /** The colour at the bottom of the ramp, and the whole colour when `flat`. */
  readonly lowColor: RGB;
  readonly highColor: RGB;
  /**
   * Where the ramp starts and ends within the flock's live speed band, as
   * fractions of it: `[0, 1]` spans whatever the flock can currently do.
   * Fractions rather than world units per second, because the band moves when
   * the flock is retuned, and a stale ramp looks like one flat colour rather
   * than like a mistake.
   */
  readonly speedRange: readonly [low: number, high: number];
  /** As `speedRange`, against the flock's live density band. */
  readonly densityRange: readonly [low: number, high: number];
  /** Brightness of the mark, 0..1. */
  readonly brightness: number;

  readonly trail: TrailKind;
  /** `history` only: recorded samples drawn. Never above `MAX_TRAIL_POINTS`. */
  readonly trailPoints: number;
  /** Trail width where it leaves the boid, as a fraction of `lineWidth`. */
  readonly trailWidth: number;
  /** Exponent on the width taper. 1 narrows evenly along the trail; below 1
   * the ribbon keeps its body further back and then goes quickly. */
  readonly trailTaper: number;
  /** Trail brightness where it leaves the boid, as a fraction of `brightness`. */
  readonly trailBrightness: number;
  /** Fade exponent along the trail. 1 is linear; above it the tail goes early. */
  readonly trailFalloff: number;
  readonly trailColour: TrailColour;

  readonly blend: BlendMode;
}

function preset(
  overrides: Partial<BoidStyle> & { name: string; ramp?: ColourRamp },
): Readonly<BoidStyle> {
  const { ramp = 'signal', ...rest } = overrides;
  const [lowColor, highColor] = COLOUR_RAMPS[ramp];
  return Object.freeze({
    size: 5,
    minScreenSize: 3.5,
    floorFade: 1,
    halfAngle: 0.42,
    lineWidth: 1.4,

    colourBy: 'speed',
    lowColor,
    highColor,
    speedRange: [0, 1],
    densityRange: [0, 1],
    brightness: 0.9,

    trail: 'history',
    trailPoints: 20,
    trailWidth: 1.2,
    trailBrightness: 0.7,
    trailFalloff: 1.8,
    trailTaper: 0.7,
    trailColour: 'sampled',

    blend: 'additive',

    ...rest,
  } satisfies BoidStyle);
}

/** Bound to the number keys, and the pool comparison mode draws from. Each
 * preset after the first changes one thing. */
export const BOID_PRESETS: readonly Readonly<BoidStyle>[] = Object.freeze([
  preset({ name: 'signal', ramp: 'signal' }),

  preset({ name: 'ice', ramp: 'ice' }),
  preset({ name: 'amber', ramp: 'amber' }),
  preset({ name: 'mono', ramp: 'mono' }),
  preset({ name: 'ember', ramp: 'ember' }),
  preset({ name: 'flux', ramp: 'flux' }),

  preset({ name: 'swarm', ramp: 'signal', colourBy: 'density' }),
  preset({ name: 'press', ramp: 'mono', colourBy: 'density' }),

  preset({ name: 'short', trailPoints: 12 }),
]);

export const DEFAULT_BOID_STYLE = BOID_PRESETS[0];

/** The mark's length on screen, in the same pixel unit as `pixelsPerUnit`. */
export function markLength(style: Readonly<BoidStyle>, pixelsPerUnit: number): number {
  return Math.max(style.minScreenSize, style.size * pixelsPerUnit);
}

/** Fewest strokes that still read as a chevron rather than as a filled dot.
 * Below this the mark is mostly ink and has lost its direction. */
const MIN_STROKES_PER_MARK = 4;

/** How much of its brightness a boid keeps once the floor is holding its size
 * up. 1 above the floor, falling away below it. */
export function floorBrightness(style: Readonly<BoidStyle>, pixelsPerUnit: number): number {
  if (style.floorFade <= 0) return 1;
  const wanted = style.size * pixelsPerUnit;
  if (wanted >= style.minScreenSize) return 1;
  return (wanted / style.minScreenSize) ** style.floorFade;
}

/**
 * The stroke a mark of this length is drawn with, in the same unit. Normally
 * the style's width; it only bites at the bottom of the zoom range, where the
 * mark has hit its floor and the stroke has not.
 */
export function strokeWidth(style: Readonly<BoidStyle>, length: number): number {
  return Math.min(style.lineWidth, length / MIN_STROKES_PER_MARK);
}

/** The ramp's ends in world units, against the flock as it is right now. */
export function colourBand(
  style: Readonly<BoidStyle>,
  ranges: FlockRanges,
): readonly [number, number] {
  if (style.colourBy === 'density') {
    const [low, high] = style.densityRange;
    return [low * ranges.maxDensity, high * ranges.maxDensity];
  }
  const [low, high] = style.speedRange;
  const span = ranges.maxSpeed - ranges.minSpeed;
  return [ranges.minSpeed + low * span, ranges.minSpeed + high * span];
}

/** Where a boid lands on its style's colour ramp, 0..1: what the vertex shader
 * does per boid, in a form the tests can sweep. */
export function colourFraction(
  style: Readonly<BoidStyle>,
  ranges: FlockRanges,
  speed: number,
  density: number,
): number {
  if (style.colourBy === 'flat') return 0;
  const [low, high] = colourBand(style, ranges);
  const value = style.colourBy === 'density' ? density : speed;
  return Math.min(1, Math.max(0, (value - low) / Math.max(high - low, 1e-6)));
}

/**
 * History samples a style's ribbon draws, including the boid's live position.
 * Clamped to the rows the texture holds: asking for more would read whatever
 * is above them, and draw a trail doubling back on itself rather than fail.
 */
export function trailSamples(style: Readonly<BoidStyle>, rows: number): number {
  if (style.trail !== 'history') return 0;
  return Math.min(style.trailPoints, rows, MAX_TRAIL_POINTS) + 1;
}
