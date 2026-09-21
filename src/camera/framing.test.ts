import { describe, expect, it } from 'vitest';

import type { FlockSample } from '../sim/simulation';
import {
  approach,
  fitLogScale,
  flockReach,
  followLogScale,
  FRAME_QUANTILE,
  MAX_FRAME_LOG,
  MAX_LOG_SCALE,
  MIN_FRAME_LOG,
  MIN_LOG_SCALE,
  stepFrame,
  stepZoom,
} from './framing';

/** A sample of boids laid out along the x axis at the given radii. */
function sampleAt(radii: readonly number[]): FlockSample {
  const positions = new Float32Array(radii.length * 2);
  radii.forEach((radius, i) => {
    positions[i * 2] = radius;
  });
  return { positions, count: radii.length, centroid: { x: 0, y: 0 } };
}

const scratch = new Float64Array(64);

describe('flockReach', () => {
  it('is the radius the quantile falls on', () => {
    // Ten boids at 1..10: the 85th percentile lands on the eighth.
    const sample = sampleAt([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(flockReach(sample, 0.85, scratch)).toBe(8);
  });

  it('does not care what order they arrive in', () => {
    const shuffled = sampleAt([7, 2, 10, 5, 1, 9, 3, 8, 4, 6]);
    expect(flockReach(shuffled, 0.85, scratch)).toBe(8);
  });

  // One boid halfway to the horizon must not force a zoom-out.
  it('ignores a straggler', () => {
    const together = sampleAt([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const andOneAway = sampleAt([1, 1, 1, 1, 1, 1, 1, 1, 1, 100000]);
    expect(flockReach(andOneAway, FRAME_QUANTILE, scratch)).toBe(
      flockReach(together, FRAME_QUANTILE, scratch),
    );
  });

  it('measures from the centroid, not from the origin', () => {
    const positions = new Float32Array([100, 0, 102, 0, 104, 0, 106, 0]);
    const sample: FlockSample = { positions, count: 4, centroid: { x: 103, y: 0 } };
    expect(flockReach(sample, 1, scratch)).toBe(3);
  });

  it('is 0 for an empty flock', () => {
    expect(flockReach(sampleAt([]), FRAME_QUANTILE, scratch)).toBe(0);
  });

  it('never outgrows the buffer it is given', () => {
    const exact = new Float64Array(3);
    expect(flockReach(sampleAt([1, 2, 3]), 1, exact)).toBe(3);
  });
});

describe('fitLogScale', () => {
  it('puts the flock on screen with room to spare', () => {
    const scale = 10 ** fitLogScale(100, 800, 600);
    // Half the shorter dimension is 300 px; the flock's reach lands inside it.
    expect(100 * scale).toBeLessThan(300);
    expect(100 * scale).toBeGreaterThan(200);
  });

  it('measures against the shorter dimension whichever way the window is', () => {
    expect(fitLogScale(100, 800, 600)).toBeCloseTo(fitLogScale(100, 600, 800), 12);
  });

  // One press of `z` has to frame a flock of any size.
  it('scales inversely with the flock', () => {
    const near = 10 ** fitLogScale(10, 800, 600);
    const far = 10 ** fitLogScale(100, 800, 600);
    expect(near / far).toBeCloseTo(10, 6);
  });

  it('gives the same fraction of the window whatever the flock spans', () => {
    const fraction = (reach: number): number => (reach * 10 ** fitLogScale(reach, 800, 600)) / 300;
    for (const reach of [1, 10, 1000, 1e5]) {
      expect(fraction(reach)).toBeCloseTo(fraction(1), 6);
    }
  });

  // A flock collapsed to a point would otherwise ask for infinite magnification.
  it.each([
    ['a flock with no spread', 0],
    ['a flock smaller than the floor', 1e-12],
    ['a flock spread across the world', 1e9],
  ])('stays inside the zoom limits for %s', (_case, reach) => {
    const scale = fitLogScale(reach, 800, 600);
    expect(scale).toBeLessThanOrEqual(MAX_LOG_SCALE);
    expect(scale).toBeGreaterThanOrEqual(MIN_LOG_SCALE);
  });
});

describe('stepZoom', () => {
  it('adds decades', () => {
    expect(stepZoom(0, 0.5)).toBeCloseTo(0.5, 9);
    expect(stepZoom(1, -0.25)).toBeCloseTo(0.75, 9);
  });

  // Additive in log space is multiplicative in scale.
  it('multiplies the scale by the same factor at both ends of the range', () => {
    const factor = (from: number): number => 10 ** stepZoom(from, 0.1) / 10 ** from;
    expect(factor(-2)).toBeCloseTo(factor(2), 9);
  });

  it.each([
    ['at the top', MAX_LOG_SCALE, 1, MAX_LOG_SCALE],
    ['at the bottom', MIN_LOG_SCALE, -1, MIN_LOG_SCALE],
  ])('clamps %s', (_case, from, decades, expected) => {
    expect(stepZoom(from, decades)).toBe(expected);
  });

  it('comes back to where it started', () => {
    expect(stepZoom(stepZoom(0.4, 0.3), -0.3)).toBeCloseTo(0.4, 9);
  });
});

describe('followLogScale', () => {
  it('is a plain fit at 100%', () => {
    expect(followLogScale(100, 800, 600, 0)).toBeCloseTo(fitLogScale(100, 800, 600), 12);
  });

  // The wheel moves decades, so one notch has to mean the same either side of
  // the follow switch.
  it('trades a decade of frame for a decade of zoom', () => {
    const fit = fitLogScale(100, 800, 600);
    expect(followLogScale(100, 800, 600, 1)).toBeCloseTo(fit - 1, 12);
    expect(followLogScale(100, 800, 600, -1)).toBeCloseTo(fit + 1, 12);
  });

  it.each([
    ['as far out as the slider goes', MAX_FRAME_LOG],
    ['as far in as the slider goes', MIN_FRAME_LOG],
  ])('stays inside the zoom limits %s', (_case, frameLog) => {
    const scale = followLogScale(1e-9, 800, 600, frameLog);
    expect(scale).toBeLessThanOrEqual(MAX_LOG_SCALE);
    expect(scale).toBeGreaterThanOrEqual(MIN_LOG_SCALE);
  });
});

describe('stepFrame', () => {
  it.each([
    ['at the top', MAX_FRAME_LOG, 1, MAX_FRAME_LOG],
    ['at the bottom', MIN_FRAME_LOG, -1, MIN_FRAME_LOG],
  ])('clamps %s', (_case, from, decades, expected) => {
    expect(stepFrame(from, decades)).toBe(expected);
  });
});

describe('approach', () => {
  // The whole point: a flock breathing inside the band moves the camera not at all.
  it('does not move while the target is inside the tolerance', () => {
    expect(approach(1, 1.05, 0.1, 0.5, 1 / 60)).toBe(1);
    expect(approach(1, 0.95, 0.1, 0.5, 1 / 60)).toBe(1);
  });

  it('moves once the target passes the tolerance', () => {
    expect(approach(1, 2, 0.1, 0.5, 1 / 60)).toBeGreaterThan(1);
    expect(approach(1, 0, 0.1, 0.5, 1 / 60)).toBeLessThan(1);
  });

  // Stick-slip is what a naive deadband gives: move to the target, fall back
  // inside the band, stop, get pushed out again.
  it('comes to rest one tolerance short and stays there', () => {
    let value = 0;
    for (let i = 0; i < 2000; i++) value = approach(value, 1, 0.1, 0.2, 1 / 60);
    expect(value).toBeCloseTo(0.9, 6);
    expect(approach(value, 1, 0.1, 0.2, 1 / 60)).toBeCloseTo(value, 12);
  });

  it('never overshoots, however long the step', () => {
    expect(approach(0, 1, 0.1, 0.2, 10)).toBeLessThanOrEqual(0.9);
    expect(approach(0, -1, 0.1, 0.2, 10)).toBeGreaterThanOrEqual(-0.9);
  });

  // Otherwise the camera would feel different on a 120 Hz display.
  it('lands in the same place whatever the framerate', () => {
    const walk = (dt: number, steps: number): number => {
      let value = 0;
      for (let i = 0; i < steps; i++) value = approach(value, 1, 0.1, 0.5, dt);
      return value;
    };
    expect(walk(1 / 120, 120)).toBeCloseTo(walk(1 / 30, 30), 12);
    expect(walk(1, 1)).toBeCloseTo(walk(1 / 60, 60), 12);
  });

  it('snaps to the edge of the band with no time constant', () => {
    expect(approach(0, 1, 0.1, 0, 1 / 60)).toBeCloseTo(0.9, 12);
  });

  it('stands still when no time has passed', () => {
    expect(approach(0, 1, 0.1, 0.5, 0)).toBe(0);
  });
});
