import { describe, expect, it } from 'vitest';

import { BOID_PRESETS, colourBand, colourFraction, DEFAULT_BOID_STYLE } from '../render/boid-style';
import type { SimInput } from '../sim/simulation';
import { createPoseTrack, DESIGN_SPECIMENS } from './pose-track';

/**
 * The harness only earns its place if the heading it draws is the heading the
 * boid is travelling. A chevron pointing somewhere other than along its own
 * path is invisible on a still frame and would poison every judgement made in
 * 4a, so the agreement between position and velocity is pinned here.
 */

const NO_CURSOR: SimInput = { cursor: null };
const DT = 1 / 1000;

describe('pose track', () => {
  it('flies one boid per specimen', () => {
    const track = createPoseTrack();
    expect(track.count).toBe(DESIGN_SPECIMENS.length);
    expect(track.capacity).toBe(DESIGN_SPECIMENS.length);
  });

  it('points every boid along the path it is travelling', () => {
    const track = createPoseTrack();
    const before = new Float32Array(track.positions.length);

    let samples = 0;
    let aligned = 0;

    for (let step = 0; step < 6000; step++) {
      before.set(track.positions);
      const velocities = Float32Array.from(track.velocities);
      track.step(DT, NO_CURSOR);

      for (let i = 0; i < track.count; i++) {
        const moveX = track.positions[i * 2] - before[i * 2];
        const moveY = track.positions[i * 2 + 1] - before[i * 2 + 1];
        const moved = Math.hypot(moveX, moveY);
        const speed = Math.hypot(velocities[i * 2], velocities[i * 2 + 1]);
        if (moved < 1e-9 || speed < 1e-9) continue;

        const alignment =
          (moveX * velocities[i * 2] + moveY * velocities[i * 2 + 1]) / (moved * speed);
        samples++;
        if (alignment > 0.9999) aligned++;
        // The square's corners turn a right angle between one sample and the
        // next, and a central difference across a corner splits the
        // difference — which is what a boid with a turn-rate limit would do.
        // Never worse than that, and never backwards.
        expect(alignment).toBeGreaterThan(0.5);
      }
    }

    expect(samples).toBeGreaterThan(30000);
    expect(aligned / samples).toBeGreaterThan(0.99);
  });

  it('keeps every boid moving, at a speed a flock could reach', () => {
    const track = createPoseTrack();
    for (let step = 0; step < 2000; step++) {
      track.step(DT, NO_CURSOR);
      for (let i = 0; i < track.count; i++) {
        const speed = Math.hypot(track.velocities[i * 2], track.velocities[i * 2 + 1]);
        expect(Number.isFinite(track.positions[i * 2])).toBe(true);
        expect(Number.isFinite(track.positions[i * 2 + 1])).toBe(true);
        expect(speed).toBeGreaterThan(1);
        expect(speed).toBeLessThan(200);
      }
    }
  });

  /**
   * The specimens exist to be looked at through the styles, and the styles map
   * a speed ramp. Specimens that all flew above the top of it would paint the
   * whole row one colour and make the colour presets unjudgeable, which is
   * what the first set of periods did.
   */
  it('flies at speeds the colour ramp can tell apart', () => {
    const track = createPoseTrack();
    const style = DEFAULT_BOID_STYLE;
    const [low, high] = colourBand(style, track.ranges);
    let slowest = Infinity;
    let fastest = -Infinity;

    for (let step = 0; step < 120 * 240; step++) {
      track.step(1 / 240, NO_CURSOR);
      for (let i = 0; i < track.count; i++) {
        const speed = Math.hypot(track.velocities[i * 2], track.velocities[i * 2 + 1]);
        slowest = Math.min(slowest, speed);
        fastest = Math.max(fastest, speed);
      }
    }

    // Inside the ramp, with only a little room to spare at either end: a
    // specimen well outside it is pinned to one end and shows nothing.
    expect(slowest).toBeGreaterThan(low * 0.8);
    expect(fastest).toBeLessThan(high * 1.1);
    // And between them the specimens cover it, so somewhere in the row every
    // part of the ramp is on screen.
    expect(colourFraction(style, track.ranges, slowest, 0)).toBeLessThan(0.15);
    expect(colourFraction(style, track.ranges, fastest, 0)).toBeGreaterThan(0.9);
  });

  /**
   * The specimens are laid out so panning along the row walks from the
   * gentlest path to the harshest; the crowding they report is laid out the
   * same way, so the density ramp reads left to right across them. It swings
   * as they fly, on periods that do not divide into each other, so the trail
   * carries a gradient rather than one flat colour per specimen.
   */
  it('reports synthetic densities that spread across the ramp and move', () => {
    const track = createPoseTrack();
    const style = BOID_PRESETS.find((preset) => preset.colourBy === 'density');
    if (!style) throw new Error('no density preset to check the range against');

    const low = DESIGN_SPECIMENS.map(() => Infinity);
    const high = DESIGN_SPECIMENS.map(() => -Infinity);
    for (let step = 0; step < 60 * 240; step++) {
      track.step(1 / 240, NO_CURSOR);
      for (let i = 0; i < track.count; i++) {
        low[i] = Math.min(low[i], track.densities[i]);
        high[i] = Math.max(high[i], track.densities[i]);
      }
    }

    for (let i = 0; i < track.count; i++) {
      // Each one moves, so the ribbon is never a flat colour.
      expect(high[i] - low[i]).toBeGreaterThan(5);
      expect(low[i]).toBeGreaterThanOrEqual(0);
      if (i > 0) expect(low[i]).toBeGreaterThan(low[i - 1]);
    }
    // And between them they cover the ramp a density style maps.
    expect(colourFraction(style, track.ranges, 0, Math.min(...low))).toBeLessThan(0.15);
    expect(colourFraction(style, track.ranges, 0, Math.max(...high))).toBeGreaterThan(0.9);
  });

  it('returns to the same state for the same elapsed time', () => {
    const track = createPoseTrack();
    for (let step = 0; step < 500; step++) track.step(DT, NO_CURSOR);
    const flown = Float32Array.from(track.positions);

    track.reset(0);
    for (let step = 0; step < 500; step++) track.step(DT, NO_CURSOR);
    expect(Array.from(track.positions)).toEqual(Array.from(flown));
  });

  it('bumps its revision so the feed knows to upload', () => {
    const track = createPoseTrack();
    const before = track.revision;
    track.step(DT, NO_CURSOR);
    expect(track.revision).not.toBe(before);
  });
});
