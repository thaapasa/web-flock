import { describe, expect, it } from 'vitest';

import {
  bandCount,
  bandPhase,
  bandWeight,
  computeBands,
  createBands,
  lineBrightness,
  MAX_BANDS,
} from './grid-bands';
import type { GridStyle } from './grid-style';
import { DEFAULT_GRID_STYLE, GRID_PRESETS } from './grid-style';

/** log10(CSS pixels per world unit), swept across the range the wheel covers. */
function zoomSweep(step: number): number[] {
  const values: number[] = [];
  for (let logScale = -3; logScale <= 3 + 1e-9; logScale += step) values.push(logScale);
  return values;
}

/** World coordinates of lines belonging to a spread of different decades. */
const SAMPLE_LINES = [0.01, 0.1, 1, 5, 10, 100, 300, 1000, 10000, 1e5, 1e6, 123000];

const PRESET_CASES = GRID_PRESETS.map((style) => [style.name, style] as const);

describe('band selection', () => {
  it.each(PRESET_CASES)('holds its invariants across the zoom range (%s)', (_name, style) => {
    const bands = createBands();
    for (const logScale of zoomSweep(0.01)) {
      const count = computeBands(10 ** logScale, style, bands);

      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(MAX_BANDS);

      for (let i = 0; i < count; i++) {
        const band = bands[i];
        expect(band.weight).toBeGreaterThanOrEqual(0);
        expect(band.weight).toBeLessThanOrEqual(1);
        if (i > 0) {
          // Decades, in order, each ten times coarser and no dimmer.
          expect(band.exponent).toBe(bands[i - 1].exponent + 1);
          expect(band.spacing / bands[i - 1].spacing).toBeCloseTo(10, 6);
          expect(band.weight).toBeGreaterThanOrEqual(bands[i - 1].weight);
        }
      }
    }
  });

  it('admits a decade only once its lines are far enough apart', () => {
    const bands = createBands();
    const { minPixelSpacing } = DEFAULT_GRID_STYLE;
    for (const logScale of zoomSweep(0.013)) {
      computeBands(10 ** logScale, DEFAULT_GRID_STYLE, bands);
      expect(bands[0].spacing).toBeGreaterThanOrEqual(minPixelSpacing - 1e-9);
      expect(bands[0].spacing).toBeLessThan(minPixelSpacing * 10 + 1e-9);
    }
  });

  it('enters at exactly zero weight, so a decade fades up out of black', () => {
    expect(bandWeight(9, 9, 2, 'smooth')).toBe(0);
    expect(bandWeight(9, 9, 1, 'late')).toBe(0);
  });

  it('saturates at the top band, so the decade above it draws the same', () => {
    const bands = createBands();
    for (const style of GRID_PRESETS) {
      for (const logScale of zoomSweep(0.017)) {
        const count = computeBands(10 ** logScale, style, bands);
        expect(bands[count - 1].weight).toBe(1);
      }
    }
  });

  it('never asks for more bands than the shader evaluates', () => {
    expect(bandCount(0.5)).toBe(2);
    expect(bandCount(1)).toBe(2);
    expect(bandCount(2)).toBe(3);
    expect(bandCount(9)).toBe(MAX_BANDS);
  });
});

describe('handover continuity', () => {
  /**
   * The one that matters: scrolling must not make the picture pop. A line's
   * brightness is sampled either side of a very small zoom change, everywhere
   * across six decades of zoom, and the jump is required to stay far below
   * anything an eye would read as an edge.
   */
  it.each(PRESET_CASES)('moves no line brightness abruptly (%s)', (_name, style: GridStyle) => {
    const bands = createBands();
    const brightness = (logScale: number, value: number): number => {
      const count = computeBands(10 ** logScale, style, bands);
      return lineBrightness(value, bands, count);
    };

    const step = 0.002;
    for (const value of SAMPLE_LINES) {
      let previous = brightness(-3, value);
      for (let logScale = -3 + step; logScale <= 3; logScale += step) {
        const current = brightness(logScale, value);
        expect(Math.abs(current - previous)).toBeLessThan(0.02);
        previous = current;
      }
    }
  });

  /**
   * Zooming in gives every line more room, and a line that has more room must
   * never be drawn dimmer than it was. Stated as a direction rather than as a
   * value, so that retuning the default style by eye cannot make it wrong —
   * what it forbids is a coarse line dipping as a finer decade appears under
   * it, which is the failure that would read as the grid flickering.
   */
  it.each(PRESET_CASES)('never dims a line as it gains room (%s)', (_name, style: GridStyle) => {
    const bands = createBands();
    for (const value of SAMPLE_LINES) {
      let previous = 0;
      for (const logScale of zoomSweep(0.01)) {
        const count = computeBands(10 ** logScale, style, bands);
        const brightness = lineBrightness(value, bands, count);
        expect(brightness).toBeGreaterThanOrEqual(previous - 1e-12);
        previous = brightness;
      }
    }
  });

  it('gives a line the brightness of the coarsest decade it belongs to', () => {
    const bands = createBands();
    // A style written out here rather than the default one: this asserts the
    // structure of the result, and structure should not move when the default
    // is retuned by eye.
    const count = computeBands(1, { ...DEFAULT_GRID_STYLE, minPixelSpacing: 9 }, bands);
    // At 1 px per unit with a 9 px minimum, the decades on screen start at 1.
    expect(bands[0].exponent).toBe(1);
    expect(lineBrightness(10, bands, count)).toBe(bands[0].weight);
    expect(lineBrightness(100, bands, count)).toBe(bands[1].weight);
    expect(lineBrightness(1000, bands, count)).toBe(bands[2].weight);
    // Not on any visible decade.
    expect(lineBrightness(3, bands, count)).toBe(0);
  });
});

describe('phase reduction', () => {
  it('lands on a real line of the decade', () => {
    const cases = [
      { centre: 0, exponent: 0 },
      { centre: 1234.5, exponent: 1 },
      { centre: -87.25, exponent: 0 },
      { centre: 1234567.89, exponent: 2 },
      { centre: -9876543.21, exponent: 3 },
      { centre: 0.04321, exponent: -2 },
    ];
    for (const { centre, exponent } of cases) {
      const pixelsPerUnit = 7.5;
      const phase = bandPhase(centre, exponent, pixelsPerUnit);
      const spacing = 10 ** exponent;
      // Within half a spacing of the centre, and on a multiple of the spacing.
      expect(Math.abs(phase)).toBeLessThanOrEqual((spacing * pixelsPerUnit) / 2 + 1e-9);
      const nearestLine = centre - phase / pixelsPerUnit;
      expect(nearestLine / spacing).toBeCloseTo(Math.round(nearestLine / spacing), 6);
    }
  });

  it('stays sub-pixel accurate far from the origin, where float32 would not', () => {
    // A million world units out at 40 px per unit: what reaches the shader must
    // still be a small number, not the difference of two large ones.
    expect(bandPhase(1_000_000.37, 0, 40)).toBeCloseTo(14.8, 6);
  });
});
