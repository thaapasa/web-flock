import { describe, expect, it } from 'vitest';

import { withDefines } from './gl';

/**
 * A GLSL source whose `#version` is not the first line fails to compile, and the
 * message does not name the real cause. Easy to get wrong by one line and hard
 * to diagnose, so it is pinned here.
 */
describe('withDefines', () => {
  const source = '#version 300 es\nprecision highp float;\nvoid main() {}\n';

  it('puts the defines after the version directive', () => {
    expect(withDefines(source, { MAX_BANDS: 5 })).toBe(
      '#version 300 es\n#define MAX_BANDS 5\nprecision highp float;\nvoid main() {}\n',
    );
  });

  it('puts them at the top when there is no version directive', () => {
    expect(withDefines('void main() {}\n', { A: 1 })).toBe('#define A 1\nvoid main() {}\n');
  });

  it('writes one line per define', () => {
    expect(withDefines(source, { A: 1, B: 2 })).toContain('#define A 1\n#define B 2\n');
  });

  it('leaves the source untouched when there is nothing to define', () => {
    expect(withDefines(source, {})).toBe(source);
  });
});
