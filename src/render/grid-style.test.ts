import { describe, expect, it } from 'vitest';

import { GRID_STYLE, pulseRate } from './grid-style';

describe('pulseRate', () => {
  it('crosses in pulseTravel seconds at pulseStrength', () => {
    expect(pulseRate(GRID_STYLE, GRID_STYLE.pulseStrength)).toBeCloseTo(1 / GRID_STYLE.pulseTravel);
  });

  it('doubles for four times the strength', () => {
    const base = pulseRate(GRID_STYLE, 400);
    expect(pulseRate(GRID_STYLE, 1600)).toBeCloseTo(base * 2);
  });

  it('stops at zero strength', () => {
    expect(pulseRate(GRID_STYLE, 0)).toBe(0);
  });
});
