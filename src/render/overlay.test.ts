import { describe, expect, it } from 'vitest';

import { formatTick } from './overlay';

/**
 * `exponent` is the decade the tick belongs to, and it decides how many digits
 * carry information. Both formats read it, so both run against the same ladder
 * of decades rather than against isolated numbers.
 */
describe('tick formatting', () => {
  it.each([
    // value, exponent, plain, compact
    [0, 0, '0', '0'],
    [5, 0, '5', '5'],
    [-5, 0, '-5', '-5'],
    [10, 1, '10', '10'],
    [500, 2, '500', '500'],
    [1000, 2, '1000', '1k'],
    [1200, 2, '1200', '1.2k'],
    [-1200, 2, '-1200', '-1.2k'],
    [1250, 1, '1250', '1.25k'],
    [10000, 3, '10000', '10k'],
    [1_000_000, 5, '1000000', '1M'],
    [2_500_000, 5, '2500000', '2.5M'],
    [1_230_000_000, 7, '1230000000', '1.23G'],
    [0.5, -1, '0.5', '0.5'],
    [0.01, -2, '0.01', '0.01'],
    [0.1, -2, '0.1', '0.1'],
    [-0.25, -2, '-0.25', '-0.25'],
  ])('formats %d at decade %d', (value, exponent, plain, compact) => {
    expect(formatTick(value, exponent, 'plain')).toBe(plain);
    expect(formatTick(value, exponent, 'compact')).toBe(compact);
  });

  it('falls back to exponential where a decimal would be unreadable', () => {
    expect(formatTick(0.00001, -5, 'compact')).toBe('1e-5');
    expect(formatTick(1e12, 12, 'compact')).toBe('1e12');
  });
});
