import type { Vec2 } from '../math/types';
import type { FlockRanges, FlockSample, SimInput, Simulation } from '../sim/simulation';

/**
 * Scaffolding for step 4a, and only for step 4a.
 *
 * A handful of boids flying fixed paths, so the *mark* can be judged rather
 * than the flock. It implements `Simulation`, which means the real renderer,
 * the real feed and the real trail history all run against it unchanged —
 * nothing here is a special drawing path that could look right while the
 * production one does not.
 *
 * PLAN.md asks for "a single large boid, slowly rotating, with its trail".
 * That shows the chevron but says nothing about the trail, which only has a
 * shape when the path has one: the question 4a had to settle was what a trail
 * does in a *turn*, and a boid rotating on the spot never turns. So there are
 * six specimens, from a curve so slow it is nearly straight to a corner that
 * reverses the heading in one step, and the ones in between vary their speed
 * along the path so the speed ramp has something to say.
 *
 * Positions come from a closed parametric path and velocities from a central
 * difference across it, rather than the two being written out separately. A
 * heading that disagreed with the path would be invisible on a still frame and
 * would make every judgement here worthless.
 *
 * **This whole file is deleted in step 5.** Nothing outside `dev/` may import
 * from it.
 */

/** Seconds either side of `t` used to measure the heading. */
const DIFFERENCE_STEP = 1 / 480;

/** World units between specimens. Roughly a screen apart at the design zoom. */
const SPACING = 420;

interface Specimen {
  readonly name: string;
  /** Centre of this specimen's path. */
  readonly centre: Readonly<Vec2>;
  /** Position on the path at `t` seconds, relative to the centre. */
  readonly path: (t: number, out: Vec2) => void;
  /**
   * The middle of the range this specimen reports as its crowding. Synthetic:
   * these boids have no neighbours, and a colour mode that showed nothing here
   * could not be judged at all. It swings around this value as the specimen
   * flies, so the density ramp has a gradient along the trail rather than one
   * flat colour per boid, which is what it would look like in a real flock.
   */
  readonly density: number;
}

/** How far a specimen's synthetic density swings either side of its middle. */
const DENSITY_SWING = 9;

/** Seconds per swing. Coprime-ish lengths, so the six never march in step. */
const DENSITY_PERIODS = [7, 9, 11, 13, 8, 10];

/** An ellipse. Wide and thin gives long runs joined by hairpins. */
function ellipse(radiusX: number, radiusY: number, period: number) {
  return (t: number, out: Vec2): void => {
    const angle = (t / period) * Math.PI * 2;
    out.x = Math.cos(angle) * radiusX;
    out.y = Math.sin(angle) * radiusY;
  };
}

/** A figure of eight: crosses itself, and its speed varies around the loop. */
function lemniscate(radius: number, period: number) {
  return (t: number, out: Vec2): void => {
    const angle = (t / period) * Math.PI * 2;
    out.x = Math.sin(angle) * radius;
    out.y = (Math.sin(angle * 2) * radius) / 2;
  };
}

/** A square, travelled at a constant speed. The corners are the point. */
function square(side: number, period: number) {
  const perimeter = side * 4;
  const half = side / 2;
  return (t: number, out: Vec2): void => {
    const distance = ((((t / period) * perimeter) % perimeter) + perimeter) % perimeter;
    const leg = Math.floor(distance / side);
    const along = distance - leg * side - half;
    if (leg === 0) {
      out.x = along;
      out.y = -half;
    } else if (leg === 1) {
      out.x = half;
      out.y = along;
    } else if (leg === 2) {
      out.x = -along;
      out.y = half;
    } else {
      out.x = -half;
      out.y = -along;
    }
  };
}

function specimen(index: number, name: string, path: Specimen['path'], density: number): Specimen {
  return { name, centre: { x: index * SPACING, y: 0 }, path, density };
}

/**
 * Left to right, from the gentlest path to the harshest, so panning along the
 * row walks the trail from "barely bends" to "reverses".
 */
export const DESIGN_SPECIMENS: readonly Specimen[] = [
  specimen(0, 'drift', ellipse(260, 240, 63), 10),
  specimen(1, 'turn', ellipse(110, 110, 17), 17),
  specimen(2, 'weave', lemniscate(150, 25), 24),
  specimen(3, 'dash', ellipse(190, 60, 20), 31),
  specimen(4, 'zigzag', square(170, 14), 38),
  specimen(5, 'spin', ellipse(26, 26, 5.4), 45),
];

/**
 * log10(CSS pixels per world unit) the harness opens at: a boid of the default
 * five world units lands around a hundred pixels long, which is big enough to
 * argue about a stroke weight.
 */
export const DESIGN_LOG_SCALE = 1.3;

class PoseTrack implements Simulation {
  readonly capacity = DESIGN_SPECIMENS.length;
  readonly positions = new Float32Array(DESIGN_SPECIMENS.length * 2);
  readonly velocities = new Float32Array(DESIGN_SPECIMENS.length * 2);
  readonly densities = new Float32Array(DESIGN_SPECIMENS.length);

  /**
   * Fixed, unlike the flock's, which are estimated from what it is doing.
   * These are simply what the specimens were built to span, so a style looks
   * the same here as it does over the real thing — which is the only reason
   * the harness is worth judging a style in.
   */
  readonly ranges: FlockRanges = {
    minSpeed: 20,
    maxSpeed: 60,
    maxDensity: Math.max(...DESIGN_SPECIMENS.map((it) => it.density)) + DENSITY_SWING,
  };

  private readonly sampleState: { positions: Float32Array; count: number; centroid: Vec2 };
  private readonly scratch: Vec2 = { x: 0, y: 0 };
  private time = 0;
  private _revision = 0;

  constructor() {
    this.sampleState = {
      positions: new Float32Array(DESIGN_SPECIMENS.length * 2),
      count: DESIGN_SPECIMENS.length,
      centroid: { x: 0, y: 0 },
    };
    this.update();
  }

  get count(): number {
    return DESIGN_SPECIMENS.length;
  }

  get revision(): number {
    return this._revision;
  }

  get sample(): FlockSample {
    return this.sampleState;
  }

  step(dt: number, _input: SimInput): void {
    this.time += dt;
    this.update();
  }

  /** The harness is not parameterised: its whole point is that it never varies. */
  setParams(): void {}

  reset(): void {
    this.time = 0;
    this.update();
  }

  private update(): void {
    const scratch = this.scratch;
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < DESIGN_SPECIMENS.length; i++) {
      const { centre, path } = DESIGN_SPECIMENS[i];

      path(this.time, scratch);
      const x = centre.x + scratch.x;
      const y = centre.y + scratch.y;

      // Central difference, in world units per second. A corner rounds the
      // heading over one difference step and no more, which is what a boid
      // with a turn-rate limit would do anyway.
      path(this.time - DIFFERENCE_STEP, scratch);
      const behindX = scratch.x;
      const behindY = scratch.y;
      path(this.time + DIFFERENCE_STEP, scratch);
      const aheadX = scratch.x;
      const aheadY = scratch.y;

      this.positions[i * 2] = x;
      this.positions[i * 2 + 1] = y;
      this.velocities[i * 2] = (aheadX - behindX) / (2 * DIFFERENCE_STEP);
      this.velocities[i * 2 + 1] = (aheadY - behindY) / (2 * DIFFERENCE_STEP);

      this.sampleState.positions[i * 2] = x;
      this.sampleState.positions[i * 2 + 1] = y;

      const swing = Math.sin((this.time / DENSITY_PERIODS[i]) * Math.PI * 2);
      this.densities[i] = Math.max(0, DESIGN_SPECIMENS[i].density + swing * DENSITY_SWING);
      sumX += x;
      sumY += y;
    }

    this.sampleState.centroid.x = sumX / DESIGN_SPECIMENS.length;
    this.sampleState.centroid.y = sumY / DESIGN_SPECIMENS.length;
    this._revision++;
  }
}

export function createPoseTrack(): Simulation {
  return new PoseTrack();
}
