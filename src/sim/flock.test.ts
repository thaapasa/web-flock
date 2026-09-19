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
    // "Never escapes for good" is a statement about the long run, not about one
    // moment: what matters is that the flock's reach settles instead of
    // creeping outward. So measure it early, then measure it again over a much
    // longer window and insist it has not grown.
    //
    // Deliberately a hard case. The speed clamp means the origin spring cannot
    // slow a boid down, only turn it, so boundedness rests on the turn actually
    // winning — which is exactly the thing that could be quietly broken.
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

  it('bumps its revision when the boids move', () => {
    const simulation = makeFlock();
    const before = simulation.revision;
    simulation.step(DT, NO_CURSOR);
    expect(simulation.revision).not.toBe(before);
  });
});
