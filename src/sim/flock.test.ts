import { describe, expect, it } from 'vitest';

import { createFlock } from './flock';
import type { SimParams } from './params';
import { DEFAULT_SIM_PARAMS } from './params';
import type { SimInput, Simulation } from './simulation';

const DT = 1 / 120;
const NO_CURSOR: SimInput = { cursor: null };

function makeFlock(overrides: Partial<SimParams> = {}, seed = 1): Simulation {
  const params: SimParams = { ...DEFAULT_SIM_PARAMS, count: 300, ...overrides };
  return createFlock({ capacity: Math.max(params.count, 600), params, seed });
}

function run(simulation: Simulation, steps: number, input: SimInput = NO_CURSOR): void {
  for (let i = 0; i < steps; i++) simulation.step(DT, input);
}

function speedOf(simulation: Simulation, i: number): number {
  return Math.hypot(simulation.velocities[i * 2], simulation.velocities[i * 2 + 1]);
}

function expectAllFinite(simulation: Simulation, label: string): void {
  for (let i = 0; i < simulation.count; i++) {
    for (const value of [
      simulation.positions[i * 2],
      simulation.positions[i * 2 + 1],
      simulation.velocities[i * 2],
      simulation.velocities[i * 2 + 1],
    ]) {
      if (!Number.isFinite(value)) {
        throw new Error(`${label}: boid ${i} is not finite (${value})`);
      }
    }
  }
}

describe('flock', () => {
  it('reproduces a run exactly from its seed', () => {
    const a = makeFlock({}, 12345);
    const b = makeFlock({}, 12345);
    run(a, 200);
    run(b, 200);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.velocities)).toEqual(Array.from(b.velocities));
  });

  it('gives different seeds different flocks', () => {
    const a = makeFlock({}, 1);
    const b = makeFlock({}, 2);
    expect(Array.from(a.positions)).not.toEqual(Array.from(b.positions));
  });

  it('returns to the same starting state on reset', () => {
    const simulation = makeFlock({}, 99);
    const start = Array.from(simulation.positions);
    run(simulation, 50);
    expect(Array.from(simulation.positions)).not.toEqual(start);
    simulation.reset(99);
    expect(Array.from(simulation.positions)).toEqual(start);
  });

  it('stays finite over a long run', () => {
    const simulation = makeFlock();
    run(simulation, 1200);
    expectAllFinite(simulation, 'default parameters');
  });

  it('stays finite under parameters chosen to break it', () => {
    // Every knob at a value a slider could reach and a careful person would
    // not: overlapping boids, enormous gains, a zero floor on speed.
    const simulation = makeFlock({
      count: 400,
      separationRadius: 0,
      neighbourRadius: 0,
      fieldOfView: 0,
      separationWeight: 1e6,
      alignmentWeight: 1e6,
      cohesionWeight: 1e6,
      maxForce: 1e9,
      originPull: 50,
      minSpeed: 0,
      maxSpeed: 1e5,
      maxTurnRate: 1e4,
      wanderStrength: 1e5,
      spawnRadius: 0,
    });
    run(simulation, 400, { cursor: { x: 0, y: 0 } });
    expectAllFinite(simulation, 'hostile parameters');
  });

  it('keeps every speed inside its bounds, on every step', () => {
    const simulation = makeFlock({ minSpeed: 20, maxSpeed: 60 });
    for (let step = 0; step < 300; step++) {
      simulation.step(DT, NO_CURSOR);
      for (let i = 0; i < simulation.count; i++) {
        const speed = speedOf(simulation, i);
        expect(speed).toBeGreaterThanOrEqual(20 - 1e-3);
        expect(speed).toBeLessThanOrEqual(60 + 1e-3);
      }
    }
  });

  it('never turns a boid faster than the turn rate allows', () => {
    const maxTurnRate = 0.5;
    const simulation = makeFlock({ maxTurnRate, cohesionWeight: 20, separationWeight: 20 });
    const limit = maxTurnRate * DT;

    const headings = (): number[] => {
      const out: number[] = [];
      for (let i = 0; i < simulation.count; i++) {
        out.push(Math.atan2(simulation.velocities[i * 2 + 1], simulation.velocities[i * 2]));
      }
      return out;
    };

    let before = headings();
    for (let step = 0; step < 200; step++) {
      simulation.step(DT, NO_CURSOR);
      const after = headings();
      for (let i = 0; i < after.length; i++) {
        let delta = after[i] - before[i];
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        expect(Math.abs(delta), `boid ${i} on step ${step}`).toBeLessThanOrEqual(limit + 1e-3);
      }
      before = after;
    }
  });

  it('keeps the flock from escaping, however fast it flies', () => {
    // Escaping is about the long run, so measure the flock's reach early, then
    // again over a much longer window, and insist it has not grown.
    //
    // A hard case on purpose: the speed clamp means the origin spring cannot
    // slow a boid down, only turn it, so boundedness rests on the turn winning.
    const simulation = makeFlock({ originPull: 0.5, maxSpeed: 400, minSpeed: 400 });

    const maxRadius = (): number => {
      let max = 0;
      for (let i = 0; i < simulation.count; i++) {
        max = Math.max(
          max,
          Math.hypot(simulation.positions[i * 2], simulation.positions[i * 2 + 1]),
        );
      }
      return max;
    };

    run(simulation, 3000);
    const settled = maxRadius();

    let later = 0;
    for (let block = 0; block < 12; block++) {
      run(simulation, 1000);
      later = Math.max(later, maxRadius());
    }

    expect(later, 'the flock is creeping outward').toBeLessThan(settled * 1.5);
    expect(later).toBeLessThan(4000);
  });

  it('scatters the flock away from a repelling cursor', () => {
    const at = { x: 0, y: 0 };
    const near = (simulation: Simulation): number => {
      let n = 0;
      for (let i = 0; i < simulation.count; i++) {
        if (Math.hypot(simulation.positions[i * 2], simulation.positions[i * 2 + 1]) < 60) n++;
      }
      return n;
    };

    const simulation = makeFlock({ spawnRadius: 50, cursorStrength: -500, cursorRadius: 200 });
    const before = near(simulation);
    run(simulation, 120, { cursor: at });
    expect(near(simulation)).toBeLessThan(before);
  });

  it('keeps boids apart when an attracting cursor packs them together', () => {
    const closest = (simulation: Simulation): number => {
      const p = simulation.positions;
      let min = Infinity;
      for (let i = 0; i < simulation.count; i++) {
        for (let j = i + 1; j < simulation.count; j++) {
          min = Math.min(min, Math.hypot(p[j * 2] - p[i * 2], p[j * 2 + 1] - p[i * 2 + 1]));
        }
      }
      return min;
    };
    const squeeze = { spawnRadius: 100, cursorStrength: 800, cursorRadius: 300 };
    const packed = { cursor: { x: 0, y: 0 } };

    const free = makeFlock({ ...squeeze, contactDistance: 0 });
    run(free, 600, packed);
    expect(closest(free), 'the squeeze is too weak to test anything').toBeLessThan(1);

    const held = makeFlock({ ...squeeze, contactDistance: 6 });
    run(held, 600, packed);
    expect(closest(held)).toBeGreaterThan(3);
  });

  it('adds new boids to the flock that is flying, not to where it started', () => {
    const params: SimParams = { ...DEFAULT_SIM_PARAMS, count: 200, spawnRadius: 100 };
    const simulation = createFlock({ capacity: 600, params, seed: 4 });
    run(simulation, 400);

    const existing: number[] = [];
    for (let i = 0; i < 200; i++) {
      existing.push(simulation.positions[i * 2], simulation.positions[i * 2 + 1]);
    }

    simulation.setParams({ ...params, count: 400 });
    expect(simulation.count).toBe(400);

    const reach = params.separationRadius * 2 + 1e-3;
    for (let i = 200; i < 400; i++) {
      const x = simulation.positions[i * 2];
      const y = simulation.positions[i * 2 + 1];
      const nearest = Math.min(
        ...Array.from({ length: 200 }, (_, j) =>
          Math.hypot(x - existing[j * 2], y - existing[j * 2 + 1]),
        ),
      );
      expect(nearest, `boid ${i} was not spawned beside the flock`).toBeLessThanOrEqual(reach);

      const speed = speedOf(simulation, i);
      expect(speed).toBeGreaterThanOrEqual(params.minSpeed - 1e-3);
      expect(speed).toBeLessThanOrEqual(params.maxSpeed + 1e-3);
    }

    run(simulation, 50);
    expectAllFinite(simulation, 'after growing the flock');
  });

  it('leaves the surviving boids untouched when the count drops', () => {
    const params: SimParams = { ...DEFAULT_SIM_PARAMS, count: 300 };
    const simulation = createFlock({ capacity: 600, params, seed: 8 });
    run(simulation, 100);
    const kept = Array.from(simulation.positions.subarray(0, 100 * 2));

    simulation.setParams({ ...params, count: 100 });
    expect(simulation.count).toBe(100);
    expect(Array.from(simulation.positions.subarray(0, 100 * 2))).toEqual(kept);
  });

  it('honours the capacity ceiling', () => {
    const params: SimParams = { ...DEFAULT_SIM_PARAMS, count: 50 };
    const simulation = createFlock({ capacity: 64, params, seed: 1 });
    simulation.setParams({ ...params, count: 10_000 });
    expect(simulation.count).toBe(64);
  });

  it('runs an empty flock without complaint', () => {
    const params: SimParams = { ...DEFAULT_SIM_PARAMS, count: 0 };
    const simulation = createFlock({ capacity: 64, params, seed: 1 });
    run(simulation, 10);
    expect(simulation.count).toBe(0);
    expect(simulation.sample.count).toBe(0);
  });

  it('samples across the whole flock and reports its centre', () => {
    const params: SimParams = { ...DEFAULT_SIM_PARAMS, count: 500, spawnRadius: 100 };
    const simulation = createFlock({ capacity: 500, params, seed: 2, sampleSize: 64 });
    run(simulation, 10);

    const sample = simulation.sample;
    expect(sample.count).toBe(64);
    expect(Math.hypot(sample.centroid.x, sample.centroid.y)).toBeLessThan(100);

    // A prefix of the flock would all sit inside the first few indices; a
    // stride reaches the end of it.
    const last: [number, number] = [sample.positions[63 * 2], sample.positions[63 * 2 + 1]];
    let matchIndex = -1;
    for (let i = 0; i < 500; i++) {
      if (simulation.positions[i * 2] === last[0] && simulation.positions[i * 2 + 1] === last[1]) {
        matchIndex = i;
        break;
      }
    }
    expect(matchIndex).toBeGreaterThan(400);
  });

  /**
   * Checked against brute force because the spatial hash produces the counts,
   * and a neighbour-lookup bug does not crash. It only tints the flock slightly
   * wrong, and someone would then spend an afternoon tuning around it.
   */
  it('counts every neighbour within the radius, and none outside it', () => {
    const params = { ...DEFAULT_SIM_PARAMS, count: 300, neighbourRadius: 18 };
    const simulation = makeFlock(params);
    run(simulation, 200);

    // Against the positions the counting pass saw, not the ones the
    // integration pass then wrote. See `Simulation.densities`.
    const seen = Float32Array.from(simulation.positions);
    simulation.step(DT, NO_CURSOR);

    const radius2 = params.neighbourRadius ** 2;
    for (let i = 0; i < simulation.count; i++) {
      let expected = 0;
      for (let j = 0; j < simulation.count; j++) {
        if (j === i) continue;
        const dx = seen[j * 2] - seen[i * 2];
        const dy = seen[j * 2 + 1] - seen[i * 2 + 1];
        const distance2 = dx * dx + dy * dy;
        if (distance2 > 0 && distance2 <= radius2) expected++;
      }
      expect(simulation.densities[i]).toBe(expected);
    }
  });

  /**
   * A field-of-view filter here would change a boid's colour as it turned,
   * which reads as flicker rather than as information.
   */
  it('counts neighbours behind a boid as well as ahead of it', () => {
    const narrow = makeFlock({ count: 300, fieldOfView: 0.2 });
    const wide = makeFlock({ count: 300, fieldOfView: Math.PI });
    // One step from an identical seeded start: the flocks have not diverged
    // yet, so any difference in the counts is the field of view leaking in.
    narrow.step(DT, NO_CURSOR);
    wide.step(DT, NO_CURSOR);
    expect(Array.from(narrow.densities)).toEqual(Array.from(wide.densities));
  });

  /**
   * Why the ramps hold fractions rather than world values. Crowding scales with
   * how many boids there are, so a band fixed for five hundred sits pinned at
   * the top for five thousand, and a pinned ramp colours every boid the same.
   */
  it('grows its density band as the flock thickens', () => {
    const bandFor = (count: number): number => {
      const simulation = makeFlock({ count });
      run(simulation, 1200);
      return simulation.ranges.maxDensity;
    };

    const small = bandFor(300);
    const large = bandFor(1500);
    expect(small).toBeGreaterThan(1);
    expect(large).toBeGreaterThan(small * 1.5);
  });

  it('reports the speed bounds it is actually holding the flock to', () => {
    const simulation = makeFlock({ minSpeed: 30, maxSpeed: 90 });
    run(simulation, 60);
    expect(simulation.ranges.minSpeed).toBe(30);
    expect(simulation.ranges.maxSpeed).toBe(90);

    // Live, like every other parameter: no restart.
    simulation.setParams({ ...DEFAULT_SIM_PARAMS, minSpeed: 5, maxSpeed: 15 });
    run(simulation, 1);
    expect(simulation.ranges.minSpeed).toBe(5);
    expect(simulation.ranges.maxSpeed).toBe(15);
  });

  /**
   * A band divides a colour. If it tracked its estimate exactly it would twitch
   * every step and shimmer the whole flock between hues.
   */
  it('moves its density band smoothly rather than in jumps', () => {
    const simulation = makeFlock({ count: 800 });
    run(simulation, 600);

    let previous = simulation.ranges.maxDensity;
    let worst = 0;
    for (let step = 0; step < 600; step++) {
      simulation.step(DT, NO_CURSOR);
      worst = Math.max(worst, Math.abs(simulation.ranges.maxDensity - previous));
      previous = simulation.ranges.maxDensity;
    }
    // Well under a whole neighbour per step, at 120 steps a second.
    expect(worst).toBeLessThan(0.25);
  });

  it('bumps its revision when the boids move', () => {
    const simulation = makeFlock();
    const before = simulation.revision;
    simulation.step(DT, NO_CURSOR);
    expect(simulation.revision).not.toBe(before);
  });
});
