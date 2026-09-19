import { describe, expect, it } from 'vitest';

import { Camera } from './camera';

/** Applies a column-major mat3 to a world point, the way a vertex shader does. */
function applyMat3(m: Float32Array, x: number, y: number): { x: number; y: number } {
  return {
    x: m[0] * x + m[3] * y + m[6],
    y: m[1] * x + m[4] * y + m[7],
  };
}

describe('Camera', () => {
  const camera = (): Camera =>
    new Camera({
      center: { x: 120, y: -40 },
      logScale: 0.5,
      viewportWidth: 800,
      viewportHeight: 600,
    });

  it('holds zoom as a base-10 logarithm', () => {
    const c = new Camera({ logScale: 2 });
    expect(c.scale).toBeCloseTo(100);
    expect(c.worldPerPixel).toBeCloseTo(0.01);

    c.zoomByDecades(-1);
    expect(c.logScale).toBeCloseTo(1);
    expect(c.scale).toBeCloseTo(10);
  });

  it('round-trips world to screen and back', () => {
    const c = camera();
    for (const [x, y] of [
      [0, 0],
      [120, -40],
      [-1234.5, 678.9],
    ]) {
      const screen = c.worldToScreen(x, y);
      const world = c.screenToWorld(screen.x, screen.y);
      expect(world.x).toBeCloseTo(x, 6);
      expect(world.y).toBeCloseTo(y, 6);
    }
  });

  it('puts the camera centre at the middle of the viewport', () => {
    const c = camera();
    const screen = c.worldToScreen(c.center.x, c.center.y);
    expect(screen.x).toBeCloseTo(400);
    expect(screen.y).toBeCloseTo(300);
  });

  it('points world +y up the screen', () => {
    const c = camera();
    const middle = c.worldToScreen(c.center.x, c.center.y);
    const above = c.worldToScreen(c.center.x, c.center.y + 100);
    // Screen y grows downward, so "up" means a smaller y.
    expect(above.y).toBeLessThan(middle.y);
  });

  it('maps the viewport edges to the edges of clip space, with +y still up', () => {
    const c = camera();
    const m = c.worldToClip();
    const halfWidthWorld = 800 / 2 / c.scale;
    const halfHeightWorld = 600 / 2 / c.scale;

    expect(applyMat3(m, c.center.x, c.center.y).x).toBeCloseTo(0);
    expect(applyMat3(m, c.center.x, c.center.y).y).toBeCloseTo(0);

    expect(applyMat3(m, c.center.x + halfWidthWorld, c.center.y).x).toBeCloseTo(1);
    expect(applyMat3(m, c.center.x - halfWidthWorld, c.center.y).x).toBeCloseTo(-1);
    // Clip space has +y up too, so the top of the screen is +1.
    expect(applyMat3(m, c.center.x, c.center.y + halfHeightWorld).y).toBeCloseTo(1);
    expect(applyMat3(m, c.center.x, c.center.y - halfHeightWorld).y).toBeCloseTo(-1);
  });

  it('agrees with worldToScreen about what is on screen', () => {
    const c = camera();
    const bounds = c.visibleBounds();

    const topLeft = c.worldToScreen(bounds.minX, bounds.maxY);
    expect(topLeft.x).toBeCloseTo(0);
    expect(topLeft.y).toBeCloseTo(0);

    const bottomRight = c.worldToScreen(bounds.maxX, bounds.minY);
    expect(bottomRight.x).toBeCloseTo(800);
    expect(bottomRight.y).toBeCloseTo(600);
  });

  it('recomputes the clip matrix after the camera moves', () => {
    const c = camera();
    const before = applyMat3(c.worldToClip(), 0, 0);
    c.setCenter(0, 0);
    const after = applyMat3(c.worldToClip(), 0, 0);
    expect(after.x).not.toBeCloseTo(before.x);
    expect(after.x).toBeCloseTo(0);
    expect(after.y).toBeCloseTo(0);
  });
});
