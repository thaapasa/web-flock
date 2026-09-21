/**
 * Everything adjustable about how a boid looks.
 *
 * The counterpart of `grid-style.ts`, and for the same reason: step 4a in
 * PLAN.md is a pile of decisions no amount of reasoning settles — chevron
 * proportions, line weight, what drives the colour, and above all which of the
 * two trail constructions to keep. So every one of them is a named field with
 * a range, the presets sit on the number keys, and comparison mode puts four
 * on screen at once.
 *
 * **The trail follows the path, not the velocity.** Step 4a settled that by
 * eye: a straight streak behind a turning boid points off at a tangent while
 * the boid curves away from it, and reads as wrong immediately. The streak was
 * built, compared and deleted; `none` survives only so a style can turn the
 * trail off.
 *
 * Lengths are in **CSS pixels** unless the name says world units, so a boid
 * looks the same weight on a Retina display as on a 1x one. The conversion to
 * device pixels happens once, in `boids.ts`.
 */

import type { FlockRanges } from '../sim/simulation';
import type { RGB } from './colour';
import { MAX_TRAIL_POINTS } from './trail-history';

/** What the colour ramp reads. */
export type ColourInput = 'flat' | 'speed' | 'density';

export const COLOUR_INPUT_CODES: Record<ColourInput, number> = {
  flat: 0,
  speed: 1,
  density: 2,
};

export type TrailKind = 'none' | 'history';

/**
 * Where the ribbon's colour comes from.
 *
 * `boid` gives the whole trail the boid's current colour, so it says what the
 * boid is doing now. `sampled` colours each point by what was recorded there,
 * so the trail becomes a history of the flight — a boid that has just
 * accelerated drags a cool tail behind a hot nose. Only `sampled` needs the
 * history texture's extra channels.
 */
export type TrailColour = 'boid' | 'sampled';

export const TRAIL_COLOUR_CODES: Record<TrailColour, number> = {
  boid: 0,
  sampled: 1,
};

/**
 * `additive` lets overlapping boids sum, so a dense knot burns brighter than
 * its members — which is most of what makes a crowd read as a crowd. `alpha`
 * keeps every boid at its own brightness however they pile up. Both take a
 * premultiplied fragment, so only the blend function differs.
 */
export type BlendMode = 'additive' | 'alpha';

/**
 * The colour schemes, low end of the ramp first.
 *
 * Low is a slow or lonely boid, high is a fast or crowded one, and on a black
 * background the low end doubles as the dim end — which is why none of them
 * start at a saturated mid-brightness colour. `mono` is the restrained one,
 * a single hue that only gains brightness; the rest move hue as well, from
 * `ice`'s blue-to-white through to `signal` crossing the whole wheel.
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
  /** Shown in comparison mode and in the readout. */
  readonly name: string;

  /** Nose-to-tail length of the chevron, in world units. */
  readonly size: number;
  /**
   * Floor on that length in CSS pixels, so a flock seen from far away thins
   * into a texture instead of vanishing. There is deliberately no ceiling:
   * zooming in is how 4a got a boid big enough to judge.
   */
  readonly minScreenSize: number;
  /**
   * How hard a boid dims once it has hit {@link minScreenSize}, as an exponent
   * on how far below the floor it should have been. 0 leaves it at full
   * brightness, 1 dims with its length, 2 with its area.
   *
   * Without this, zooming out is a way of making light: the mark stops
   * shrinking while the boids keep converging on screen, so the same
   * brightness lands in fewer and fewer pixels and additive blending sums it
   * into a white blob. Dimming what the floor is holding up keeps the total
   * roughly constant, which is what makes a distant flock read as a texture
   * rather than as a lamp. The same argument as the grid's box filter, which
   * lets a sub-pixel line fade rather than fattening it to a whole one.
   */
  readonly floorFade: number;
  /**
   * Angle between an arm and the backward axis, in radians. Small is a dart,
   * large is a wide V. The mark's length does not change with it — the arms
   * splay wider rather than the whole thing growing.
   */
  readonly halfAngle: number;
  /** Stroke width of the chevron, CSS pixels. Below 1 it draws dimmer, not thinner. */
  readonly lineWidth: number;

  readonly colourBy: ColourInput;
  /** The colour at the bottom of the ramp, and the whole colour when `flat`. */
  readonly lowColor: RGB;
  readonly highColor: RGB;
  /**
   * Where the ramp starts and ends **within the flock's live speed band**, as
   * fractions of it: `[0, 1]` spans whatever the flock can currently do.
   *
   * A fraction rather than world units per second, because the band moves.
   * Retuning speed in 7a would leave an absolute range spanning something the
   * flock no longer does, and a ramp that has gone stale does not look stale —
   * it looks like every boid is the same colour. See `FlockRanges`.
   */
  readonly speedRange: readonly [low: number, high: number];
  /** As {@link speedRange}, against the flock's live density band. */
  readonly densityRange: readonly [low: number, high: number];
  /** Brightness of the mark, 0..1. */
  readonly brightness: number;

  readonly trail: TrailKind;
  /** `history` only: recorded samples drawn. Never above {@link MAX_TRAIL_POINTS}. */
  readonly trailPoints: number;
  /** Trail width where it leaves the boid, as a fraction of {@link lineWidth}. */
  readonly trailWidth: number;
  /**
   * Exponent on the width taper. 1 narrows evenly along the trail; below 1 the
   * ribbon keeps its body further back and then goes quickly, which is most of
   * what makes a trail read as a comet rather than as a wedge.
   */
  readonly trailTaper: number;
  /** Trail brightness where it leaves the boid, as a fraction of {@link brightness}. */
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
    // The whole of each band: every colour in the scheme gets used.
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

/**
 * Bound to the number keys, and the pool comparison mode draws from.
 *
 * **1 is the settled look**, chosen by eye in 4a: a chevron with a ribbon
 * leaving its open back, following the path the boid took rather than pointing
 * straight down its velocity, coloured by the speed recorded at each point
 * along it. `signal` is the scheme; the five after it are the alternatives,
 * kept because step 5 hands the palette to the user as something to switch
 * rather than settling it here. The last three hold colour still and vary one
 * thing each, so a scheme chosen here can be checked against a different mark.
 *
 * Neither ramp names a world value. Both are fractions of a band the
 * simulation reports and keeps up to date, so moving the count slider or
 * retuning speed changes what the colours mean without touching a style.
 */
export const BOID_PRESETS: readonly Readonly<BoidStyle>[] = Object.freeze([
  preset({ name: 'signal', ramp: 'signal' }),

  preset({ name: 'ice', ramp: 'ice' }),
  preset({ name: 'amber', ramp: 'amber' }),
  preset({ name: 'mono', ramp: 'mono' }),
  preset({ name: 'ember', ramp: 'ember' }),
  preset({ name: 'flux', ramp: 'flux' }),

  // The other thing a boid knows about itself. Two palettes, because how well
  // density reads depends much more on the scheme than speed does: it varies
  // across the flock at one moment rather than along one boid's flight.
  preset({ name: 'swarm', ramp: 'signal', colourBy: 'density' }),
  preset({ name: 'press', ramp: 'mono', colourBy: 'density' }),

  // Two thirds the trail, for when the default still reads long.
  preset({ name: 'short', trailPoints: 12 }),
]);

/** What loads on a cold start. */
export const DEFAULT_BOID_STYLE = BOID_PRESETS[0];

/**
 * The mark's length on screen, in the same pixel unit as `pixelsPerUnit`.
 *
 * The floor keeps the mark the same throughout, never LOD, but never so small
 * it stops being a direction either.
 */
export function markLength(style: Readonly<BoidStyle>, pixelsPerUnit: number): number {
  return Math.max(style.minScreenSize, style.size * pixelsPerUnit);
}

/**
 * Fewest strokes that still read as a chevron rather than as a filled dot.
 *
 * Below this the mark is mostly ink and the direction — the one thing a boid
 * must always say — is gone. {@link strokeWidth} thins the stroke to hold the
 * ratio instead, so a distant flock keeps its marks and loses its weight,
 * which is what the box filter is for.
 */
const MIN_STROKES_PER_MARK = 4;

/**
 * How much of its brightness a boid keeps once the floor is holding its size
 * up. 1 above the floor, falling away below it. See {@link BoidStyle.floorFade}.
 */
export function floorBrightness(style: Readonly<BoidStyle>, pixelsPerUnit: number): number {
  if (style.floorFade <= 0) return 1;
  const wanted = style.size * pixelsPerUnit;
  if (wanted >= style.minScreenSize) return 1;
  return (wanted / style.minScreenSize) ** style.floorFade;
}

/**
 * The stroke a mark of this length is drawn with, in the same unit.
 *
 * Normally just the style's width. It only bites at the bottom of the zoom
 * range, where the mark has hit its floor and the stroke has not.
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

/**
 * Where a boid lands on its style's colour ramp, 0..1.
 *
 * The reference implementation of what the vertex shader does per boid, in a
 * form the tests can sweep — the same arrangement `lineBrightness` has in
 * `grid-bands.ts`.
 */
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
 *
 * Clamped to what the texture holds: a style asking for more rows than exist
 * would read whatever is in the ones above, which shows up as a trail that
 * doubles back on itself rather than as an error.
 */
export function trailSamples(style: Readonly<BoidStyle>, rows: number): number {
  if (style.trail !== 'history') return 0;
  return Math.min(style.trailPoints, rows, MAX_TRAIL_POINTS) + 1;
}
