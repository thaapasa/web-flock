import { describe, expect, it } from 'vitest';

import { formatTick } from './overlay';

/**
 * `exponent` is the decade the tick belongs to, and it decides how many digits
 * carry information, so the cases run against a ladder of decades rather than
 * against isolated numbers.
 */
describe('tick formatting', () => {
  it.each([
    // value, exponent, text
    [0, 0, '0'],
    [5, 0, '5'],
    [-5, 0, '-5'],
    [10, 1, '10'],
    [500, 2, '500'],
    [1000, 2, '1k'],
    [1200, 2, '1.2k'],
    [-1200, 2, '-1.2k'],
    [1250, 1, '1.25k'],
    [10000, 3, '10k'],
    [1_000_000, 5, '1M'],
    [2_500_000, 5, '2.5M'],
    [1_230_000_000, 7, '1.23G'],
    [0.5, -1, '0.5'],
    [0.01, -2, '0.01'],
    [0.1, -2, '0.1'],
    [-0.25, -2, '-0.25'],
  ])('formats %d at decade %d', (value, exponent, text) => {
    expect(formatTick(value, exponent)).toBe(text);
  });

  it('falls back to exponential where a decimal would be unreadable', () => {
    expect(formatTick(0.00001, -5)).toBe('1e-5');
    expect(formatTick(1e12, 12)).toBe('1e12');
  });
});
