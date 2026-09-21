import { describe, expect, it } from 'vitest';

import type { FlockRanges } from '../sim/simulation';
import type { BoidStyle } from './boid-style';
import {
  BOID_PRESETS,
  colourBand,
  colourFraction,
  DEFAULT_BOID_STYLE,
  floorBrightness,
  markLength,
  trailSamples,
} from './boid-style';
import { MAX_TRAIL_POINTS } from './trail-history';

const RANGES: FlockRanges = { minSpeed: 20, maxSpeed: 60, maxDensity: 40 };

const PRESET_CASES = BOID_PRESETS.map((style) => [style.name, style] as const);

function withStyle(overrides: Partial<BoidStyle>): Readonly<BoidStyle> {
  return { ...DEFAULT_BOID_STYLE, ...overrides };
}

describe('presets', () => {
  /**
   * The one that would fail silently. A style asking for more history than the
   * texture holds reads rows belonging to older samples, so the trail doubles
   * back on itself, which looks like a bad trail rather than a bug.
   */
  it.each(PRESET_CASES)('never asks for more history than exists (%s)', (_name, style) => {
    expect(style.trailPoints).toBeGreaterThanOrEqual(1);
    expect(style.trailPoints).toBeLessThanOrEqual(MAX_TRAIL_POINTS);
  });

  it.each(PRESET_CASES)('describes a mark with a direction (%s)', (_name, style) => {
    expect(style.size).toBeGreaterThan(0);
    expect(style.minScreenSize).toBeGreaterThan(0);
    // At or past a right angle the arms stop being a chevron and become a line
    // across the heading, which says nothing about direction.
    expect(style.halfAngle).toBeGreaterThan(0);
    expect(style.halfAngle).toBeLessThan(Math.PI / 2);
    expect(style.lineWidth).toBeGreaterThan(0);
  });

  it.each(PRESET_CASES)('describes a trail that fades rather than stops (%s)', (_name, style) => {
    expect(style.trailWidth).toBeGreaterThan(0);
    expect(style.trailBrightness).toBeGreaterThan(0);
    // Both are exponents on (1 - t). At or below zero the trail would hold its
    // width or its brightness all the way to the tail and then cut off.
    expect(style.trailTaper).toBeGreaterThan(0);
    expect(style.trailFalloff).toBeGreaterThan(0);
  });

  it.each(PRESET_CASES)('ramps from a low value to a higher one (%s)', (_name, style) => {
    const [low, high] = colourBand(style, RANGES);
    expect(high).toBeGreaterThan(low);
  });
});

describe('mark length', () => {
  it('scales with zoom while there is room for it', () => {
    const style = withStyle({ size: 5, minScreenSize: 3.5 });
    expect(markLength(style, 10)).toBe(50);
    expect(markLength(style, 100)).toBe(500);
  });

  /** The same mark throughout, never LOD, but with a floor so a distant flock
   * thins into a texture rather than disappearing. */
  it('stops shrinking at the floor, however far out the camera goes', () => {
    const style = withStyle({ size: 5, minScreenSize: 3.5 });
    for (let logScale = -6; logScale <= 0; logScale += 0.25) {
      expect(markLength(style, 10 ** logScale)).toBeGreaterThanOrEqual(3.5);
    }
    expect(markLength(style, 1e-9)).toBe(3.5);
  });
});

describe('the size floor', () => {
  /**
   * The floor stops the mark shrinking, but the boids keep converging on
   * screen. Without dimming what the floor holds up, zooming out makes light,
   * and additive blending piles it into a white blob.
   */
  it('leaves a mark alone while it is above the floor', () => {
    const style = withStyle({ size: 5, minScreenSize: 3.5, floorFade: 1 });
    expect(floorBrightness(style, 1)).toBe(1);
    expect(floorBrightness(style, 0.7)).toBe(1);
  });

  it('dims in proportion once the floor is holding it up', () => {
    const style = withStyle({ size: 5, minScreenSize: 3.5, floorFade: 1 });
    // Half the length it wanted, so half the brightness.
    expect(floorBrightness(style, 0.35)).toBeCloseTo(0.5, 10);
    expect(floorBrightness(style, 0.14)).toBeCloseTo(0.2, 10);
  });

  it('dims with the area when asked to', () => {
    const style = withStyle({ size: 5, minScreenSize: 3.5, floorFade: 2 });
    expect(floorBrightness(style, 0.35)).toBeCloseTo(0.25, 10);
  });

  it('leaves everything alone when the fade is off', () => {
    const style = withStyle({ size: 5, minScreenSize: 3.5, floorFade: 0 });
    expect(floorBrightness(style, 1e-6)).toBe(1);
  });

  it('never brightens a boid, at any zoom or exponent', () => {
    for (const style of BOID_PRESETS) {
      for (let logScale = -6; logScale <= 3; logScale += 0.25) {
        const fade = floorBrightness(style, 10 ** logScale);
        expect(fade).toBeGreaterThanOrEqual(0);
        expect(fade).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('colour ramp', () => {
  it('leaves a flat style at the low colour, whatever the boid is doing', () => {
    const style = withStyle({ colourBy: 'flat' });
    expect(colourFraction(style, RANGES, 0, 0)).toBe(0);
    expect(colourFraction(style, RANGES, 1e6, 1e6)).toBe(0);
  });

  it('spans the live band and clamps outside it', () => {
    const style = withStyle({ colourBy: 'speed', speedRange: [0, 1] });
    expect(colourFraction(style, RANGES, 20, 0)).toBe(0);
    expect(colourFraction(style, RANGES, 40, 0)).toBeCloseTo(0.5, 10);
    expect(colourFraction(style, RANGES, 60, 0)).toBe(1);
    // A boid outside the band is not an error; the ramp just has nothing
    // further to say about it.
    expect(colourFraction(style, RANGES, -100, 0)).toBe(0);
    expect(colourFraction(style, RANGES, 1e6, 0)).toBe(1);
  });

  /**
   * The point of holding the range as fractions: against a faster flock the
   * same style gives the same colours to the same relative speeds, so moving
   * the flock's speeds retunes nothing here.
   */
  it('follows the band when the flock is retuned', () => {
    const style = withStyle({ colourBy: 'speed', speedRange: [0, 1] });
    const faster: FlockRanges = { minSpeed: 200, maxSpeed: 600, maxDensity: 40 };
    expect(colourFraction(style, faster, 400, 0)).toBeCloseTo(0.5, 10);
    expect(colourBand(style, faster)).toEqual([200, 600]);
  });

  it('can map a slice of the band rather than all of it', () => {
    const style = withStyle({ colourBy: 'speed', speedRange: [0.25, 0.75] });
    // The middle half of 20..60 is 30..50.
    expect(colourBand(style, RANGES)).toEqual([30, 50]);
    expect(colourFraction(style, RANGES, 30, 0)).toBe(0);
    expect(colourFraction(style, RANGES, 40, 0)).toBeCloseTo(0.5, 10);
    expect(colourFraction(style, RANGES, 50, 0)).toBe(1);
  });

  it('reads density rather than speed when asked to', () => {
    const style = withStyle({ colourBy: 'density', densityRange: [0, 1] });
    expect(colourBand(style, RANGES)).toEqual([0, 40]);
    expect(colourFraction(style, RANGES, 1e6, 8)).toBeCloseTo(0.2, 10);
  });

  it('never leaves 0..1, across every preset and a wide sweep of inputs', () => {
    for (const style of BOID_PRESETS) {
      for (const value of [-1e6, -1, 0, 0.5, 7, 60, 1e6]) {
        const t = colourFraction(style, RANGES, value, value);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
      }
    }
  });

  /** A degenerate band must not divide by zero and paint the flock with NaN. */
  it('survives a band with no width', () => {
    const style = withStyle({ colourBy: 'speed', speedRange: [0.25, 0.25] });
    expect(colourFraction(style, RANGES, 30, 0)).toBe(0);
    expect(colourFraction(style, RANGES, 31, 0)).toBe(1);
  });
});

describe('trail samples', () => {
  it('draws nothing when the trail is turned off', () => {
    expect(trailSamples(withStyle({ trail: 'none' }), MAX_TRAIL_POINTS)).toBe(0);
  });

  it('adds the live position to the recorded ones', () => {
    const style = withStyle({ trail: 'history', trailPoints: 8 });
    expect(trailSamples(style, MAX_TRAIL_POINTS)).toBe(9);
  });

  it('clamps to the rows the texture actually holds', () => {
    const style = withStyle({ trail: 'history', trailPoints: MAX_TRAIL_POINTS * 4 });
    expect(trailSamples(style, MAX_TRAIL_POINTS)).toBe(MAX_TRAIL_POINTS + 1);
    expect(trailSamples(style, 4)).toBe(5);
  });
});
