import { createRandom, hashSeed } from '../math/rng';
import type { Vec2 } from '../math/types';
import type { SimParams } from './params';
import type {
  FlockRanges,
  FlockSample,
  SimInput,
  Simulation,
  SimulationFactory,
  SimulationOptions,
} from './simulation';
import { SpatialHash } from './spatial-hash';

const TWO_PI = Math.PI * 2;

/** Below this a vector has no usable direction and is treated as having none. */
const EPSILON = 1e-9;

/**
 * How far above the mean neighbour count the density band's top sits.
 *
 * A percentile would be the honest statistic, but it needs a sort and this
 * runs every step. Mean plus a fixed number of standard deviations takes one
 * pass, lands near the ninetieth percentile for counts spread like these, and
 * moves with the flock instead of jumping when one boid crosses a rank
 * boundary.
 */
const DENSITY_SIGMAS = 1.5;

/**
 * Seconds the density band takes to follow a change. The band divides a colour,
 * so a band twitching step to step shimmers the whole flock between hues while
 * nothing about the flock has changed.
 */
const DENSITY_TIME_CONSTANT = 1.5;

/**
 * Contact passes per step. One pass leaves overlaps in a packed crowd, and the
 * next step's push to clear them makes headings twitch. Two held a clump
 * under an attracting cursor with steadier headings than no contacts at all.
 * Three were slower and no steadier.
 */
const CONTACT_PASSES = 2;

/** Mutable view of the sample the flock owns and hands out as readonly. */
interface MutableSample {
  positions: Float32Array;
  count: number;
  centroid: Vec2;
}

/**
 * The CPU flocking backend. Classic Reynolds steering: each rule proposes a
 * desired velocity, the difference from the current velocity is a steering
 * force, and the three are summed by weight and clamped to `maxForce`.
 *
 * The two passes cannot be merged. Fusing them would let a boid see its
 * neighbours' already-updated positions, so the result would depend on
 * iteration order and the flock would grow a grain along the index axis. That
 * reads as bad tuning rather than as a bug.
 *
 * Pass one walks boids in cell order rather than index order. It only reads, so
 * order cannot change the result, and consecutive boids then share a
 * neighbourhood: one gather of the 3x3 block serves roughly ten of them.
 */
class Flock implements Simulation {
  readonly capacity: number;
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly densities: Float32Array;

  private readonly accelerations: Float32Array;
  private readonly wanderAngles: Float32Array;
  /** Per-boid xorshift32 state, so wander is jitter rather than a shared nudge. */
  private readonly noise: Uint32Array;

  private readonly hash: SpatialHash;
  private readonly candidates: Int32Array;
  /** Cells the size of the contact distance, far smaller than `hash` uses. */
  private readonly contactHash: SpatialHash;
  private readonly corrections: Float32Array;
  /**
   * Velocity the last step's contacts added, per boid. It goes into the next
   * integration with the steering, so contacts obey the speed bounds and the
   * turn rate like every other force.
   */
  private readonly contactPush: Float32Array;

  private readonly sampleState: MutableSample;

  private readonly rangeState: { minSpeed: number; maxSpeed: number; maxDensity: number };
  /** Where the density band is heading, before smoothing. */
  private densityTarget = 0;

  private params: SimParams;
  private _count: number;
  private _revision = 0;
  private spawnRandom: () => number;

  constructor(options: SimulationOptions) {
    this.capacity = Math.max(1, Math.floor(options.capacity));
    this.params = { ...options.params };

    this.positions = new Float32Array(this.capacity * 2);
    this.velocities = new Float32Array(this.capacity * 2);
    this.densities = new Float32Array(this.capacity);
    this.accelerations = new Float32Array(this.capacity * 2);
    this.wanderAngles = new Float32Array(this.capacity);
    this.noise = new Uint32Array(this.capacity);

    this.hash = new SpatialHash(this.capacity);
    this.candidates = new Int32Array(this.capacity);
    this.contactHash = new SpatialHash(this.capacity);
    this.corrections = new Float32Array(this.capacity * 2);
    this.contactPush = new Float32Array(this.capacity * 2);

    const sampleSize = Math.max(1, Math.min(Math.floor(options.sampleSize ?? 256), this.capacity));
    this.sampleState = {
      positions: new Float32Array(sampleSize * 2),
      count: 0,
      centroid: { x: 0, y: 0 },
    };

    this.rangeState = { minSpeed: 0, maxSpeed: 0, maxDensity: 1 };
    this._count = clampCount(this.params.count, this.capacity);
    // reset() replaces this. Assigned here because TypeScript cannot see that.
    this.spawnRandom = createRandom(0);
    this.reset(options.seed);
  }

  get count(): number {
    return this._count;
  }

  get revision(): number {
    return this._revision;
  }

  get sample(): FlockSample {
    return this.sampleState;
  }

  get ranges(): FlockRanges {
    return this.rangeState;
  }

  setParams(params: Readonly<SimParams>): void {
    this.params = { ...params };
    const next = clampCount(params.count, this.capacity);
    if (next > this._count) this.spawnIntoFlock(this._count, next);
    if (next !== this._count) {
      this._count = next;
      this._revision++;
      this.updateSample();
    }
  }

  reset(seed: number): void {
    const random = createRandom(hashSeed(seed));
    this.spawnRandom = createRandom(hashSeed(seed ^ 0x5bf03635));

    // Every slot, not just the live ones, so nothing is ever read uninitialised.
    this.densities.fill(0);
    this.contactPush.fill(0);
    for (let i = 0; i < this.capacity; i++) {
      this.scatterOnSpawnDisc(i, random);
      this.noise[i] = seedNoise(seed, i);
      this.wanderAngles[i] = (random() * 2 - 1) * Math.PI;
    }

    this._revision++;
    this.updateSample();
    this.snapRanges();
  }

  step(dt: number, input: SimInput): void {
    const count = this._count;
    this._revision++;
    if (count === 0) {
      this.updateSample();
      return;
    }

    const p = this.params;
    const positions = this.positions;
    const velocities = this.velocities;
    const accelerations = this.accelerations;
    const candidates = this.candidates;

    const neighbourRadius = Math.max(p.neighbourRadius, 0);
    const separationRadius = Math.max(p.separationRadius, 0);
    // One gather serves both rules, so cells must fit the larger of the two.
    const cellSize = Math.max(neighbourRadius, separationRadius, EPSILON);
    const neighbourRadius2 = neighbourRadius * neighbourRadius;
    const separationRadius2 = separationRadius * separationRadius;

    const maxSpeed = Math.max(p.maxSpeed, EPSILON);
    const minSpeed = Math.min(Math.max(p.minSpeed, 0), maxSpeed);
    const maxForce = Math.max(p.maxForce, 0);

    // The field-of-view test is `dot >= cos(fov) * distance`, which needs a
    // square root per candidate. Squaring both sides removes it, at the cost of
    // splitting on the sign: a view wider than a half-circle sees everything
    // ahead, a narrower one sees nothing behind.
    const cosFieldOfView = Math.cos(clamp(p.fieldOfView, 0, Math.PI));
    const cosFieldOfView2 = cosFieldOfView * cosFieldOfView;
    const wideFieldOfView = cosFieldOfView <= 0;

    const cursor = input.cursor;
    const cursorRadius = Math.max(p.cursorRadius, 0);
    const cursorRadius2 = cursorRadius * cursorRadius;

    this.hash.build(positions, count, cellSize);
    const entries = this.hash.entries;
    const entryCellX = this.hash.entryCellX;
    const entryCellY = this.hash.entryCellY;

    // Pass one: accelerations, from positions nobody has moved yet.
    // NaN is not a possible cell coordinate, so the first boid always gathers.
    let blockCellX = NaN;
    let blockCellY = NaN;
    let blockSize = 0;

    for (let e = 0; e < count; e++) {
      const cellX = entryCellX[e];
      const cellY = entryCellY[e];
      if (cellX !== blockCellX || cellY !== blockCellY) {
        blockSize = this.hash.gatherCellBlock(cellX, cellY, candidates);
        blockCellX = cellX;
        blockCellY = cellY;
      }

      const i = entries[e];
      const x = positions[i * 2];
      const y = positions[i * 2 + 1];
      const vx = velocities[i * 2];
      const vy = velocities[i * 2 + 1];

      const speed = Math.sqrt(vx * vx + vy * vy);
      const headingX = speed > EPSILON ? vx / speed : 1;
      const headingY = speed > EPSILON ? vy / speed : 0;

      let separationX = 0;
      let separationY = 0;
      let alignmentX = 0;
      let alignmentY = 0;
      let cohesionX = 0;
      let cohesionY = 0;
      let seen = 0;
      let crowd = 0;

      for (let k = 0; k < blockSize; k++) {
        const j = candidates[k];
        if (j === i) continue;
        const dx = positions[j * 2] - x;
        const dy = positions[j * 2 + 1] - y;
        const distance2 = dx * dx + dy * dy;
        if (distance2 < EPSILON) continue;

        if (distance2 <= separationRadius2) {
          // Points away from the neighbour and falls off as 1/distance, so a
          // boid almost touching another dominates one merely nearby.
          separationX -= dx / distance2;
          separationY -= dy / distance2;
        }

        if (distance2 <= neighbourRadius2) {
          // Counted before the field-of-view test, since crowding is not a
          // directional question. See Simulation.densities.
          crowd++;
          const dot = dx * headingX + dy * headingY;
          const inView = wideFieldOfView
            ? dot >= 0 || dot * dot <= cosFieldOfView2 * distance2
            : dot >= 0 && dot * dot >= cosFieldOfView2 * distance2;
          if (inView) {
            alignmentX += velocities[j * 2];
            alignmentY += velocities[j * 2 + 1];
            cohesionX += positions[j * 2];
            cohesionY += positions[j * 2 + 1];
            seen++;
          }
        }
      }

      let ax = 0;
      let ay = 0;

      const separationMagnitude = Math.sqrt(separationX * separationX + separationY * separationY);
      if (separationMagnitude > EPSILON) {
        const scale = maxSpeed / separationMagnitude;
        ax += p.separationWeight * (separationX * scale - vx);
        ay += p.separationWeight * (separationY * scale - vy);
      }

      if (seen > 0) {
        const alignmentMagnitude = Math.sqrt(alignmentX * alignmentX + alignmentY * alignmentY);
        if (alignmentMagnitude > EPSILON) {
          const scale = maxSpeed / alignmentMagnitude;
          ax += p.alignmentWeight * (alignmentX * scale - vx);
          ay += p.alignmentWeight * (alignmentY * scale - vy);
        }

        const towardCentreX = cohesionX / seen - x;
        const towardCentreY = cohesionY / seen - y;
        const cohesionMagnitude = Math.sqrt(
          towardCentreX * towardCentreX + towardCentreY * towardCentreY,
        );
        if (cohesionMagnitude > EPSILON) {
          const scale = maxSpeed / cohesionMagnitude;
          ax += p.cohesionWeight * (towardCentreX * scale - vx);
          ay += p.cohesionWeight * (towardCentreY * scale - vy);
        }
      }

      // The cap covers the three flocking rules only. The origin pull, the
      // cursor and wander are added after it, so the cursor can always
      // overpower flocking.
      const force = Math.sqrt(ax * ax + ay * ay);
      if (force > maxForce) {
        const scale = maxForce / force;
        ax *= scale;
        ay *= scale;
      }

      // A linear spring: negligible near the origin, so the flock migrates
      // freely, and unbounded far from it, so escape is impossible rather than
      // unlikely.
      ax -= p.originPull * x;
      ay -= p.originPull * y;

      if (cursor) {
        const toCursorX = cursor.x - x;
        const toCursorY = cursor.y - y;
        const distance2 = toCursorX * toCursorX + toCursorY * toCursorY;
        if (distance2 < cursorRadius2 && distance2 > EPSILON) {
          const distance = Math.sqrt(distance2);
          // Full strength at the cursor, nothing at the rim.
          const falloff = 1 - distance / cursorRadius;
          const scale = (p.cursorStrength * falloff) / distance;
          ax += toCursorX * scale;
          ay += toCursorY * scale;
        }
      }

      const drift = (this.nextNoise(i) * 2 - 1) * p.wanderRate * dt;
      const wander = wrapAngle(this.wanderAngles[i] + drift);
      this.wanderAngles[i] = wander;
      ax += Math.cos(wander) * p.wanderStrength;
      ay += Math.sin(wander) * p.wanderStrength;

      accelerations[i * 2] = ax;
      accelerations[i * 2 + 1] = ay;
      this.densities[i] = crowd;
    }

    // Pass two: integrate. The turn limit is an angle, but it is the same angle
    // for every boid this step, so one sine and cosine serve all of them and a
    // boid that exceeds the limit is rotated by that fixed angle. Above pi
    // there is nothing to limit, since every heading is reachable.
    const maxTurn = Math.min(Math.max(p.maxTurnRate, 0) * dt, Math.PI);
    const cosMaxTurn = Math.cos(maxTurn);
    const sinMaxTurn = Math.sin(maxTurn);

    const contactPush = this.contactPush;
    for (let i = 0; i < count; i++) {
      const vx = velocities[i * 2];
      const vy = velocities[i * 2 + 1];
      const oldSpeed = Math.sqrt(vx * vx + vy * vy);
      const oldX = oldSpeed > EPSILON ? vx / oldSpeed : 1;
      const oldY = oldSpeed > EPSILON ? vy / oldSpeed : 0;

      const steeredX = vx + accelerations[i * 2] * dt + contactPush[i * 2];
      const steeredY = vy + accelerations[i * 2 + 1] * dt + contactPush[i * 2 + 1];
      contactPush[i * 2] = 0;
      contactPush[i * 2 + 1] = 0;
      const steeredSpeed = Math.sqrt(steeredX * steeredX + steeredY * steeredY);

      // A positive test, so a NaN from anywhere upstream lands here and is
      // replaced by the previous heading instead of reaching a position and
      // corrupting the flock for good.
      const usable = steeredSpeed > EPSILON;
      let dirX = usable ? steeredX / steeredSpeed : oldX;
      let dirY = usable ? steeredY / steeredSpeed : oldY;

      const cosTurn = oldX * dirX + oldY * dirY;
      if (cosTurn < cosMaxTurn) {
        const sign = oldX * dirY - oldY * dirX >= 0 ? 1 : -1;
        const sin = sinMaxTurn * sign;
        dirX = oldX * cosMaxTurn - oldY * sin;
        dirY = oldX * sin + oldY * cosMaxTurn;
      }

      const speed = clamp(usable ? steeredSpeed : minSpeed, minSpeed, maxSpeed);
      const newX = dirX * speed;
      const newY = dirY * speed;
      velocities[i * 2] = newX;
      velocities[i * 2 + 1] = newY;
      positions[i * 2] += newX * dt;
      positions[i * 2 + 1] += newY * dt;
    }

    if (p.contactDistance > 0) {
      for (let pass = 0; pass < CONTACT_PASSES; pass++) this.resolveContacts(p.contactDistance, dt);
    }

    this.updateSample();

    this.rangeState.minSpeed = minSpeed;
    this.rangeState.maxSpeed = maxSpeed;
    const blend = Math.min(1, dt / DENSITY_TIME_CONSTANT);
    this.rangeState.maxDensity += (this.densityTarget - this.rangeState.maxDensity) * blend;
  }

  /**
   * Pushes apart every pair of boids closer than `distance`, each by half the
   * overlap.
   *
   * The push goes into the velocity as well as the position, through
   * `contactPush`. If it only moved the position, a boid would keep the
   * velocity that carried it into the crowd and be back inside it on the next
   * step. Under an attracting cursor the crowd then packed to nearly a point
   * anyway, with the step as slow as it was without contacts.
   *
   * Corrections are collected first and applied after, for the same reason
   * the step has two passes: moving boids in place would make the result
   * depend on the order they were visited in.
   */
  private resolveContacts(distance: number, dt: number): void {
    const count = this._count;
    const positions = this.positions;
    const contactPush = this.contactPush;
    const corrections = this.corrections;
    const candidates = this.candidates;
    const hash = this.contactHash;
    const distance2 = distance * distance;
    // A boid in the middle of a crowd gets pushed from every side, and on its
    // edge from one side only. Without a cap the sum there can throw a boid
    // several diameters in one step.
    const maxCorrection = distance / 2;
    const maxCorrection2 = maxCorrection * maxCorrection;

    hash.build(positions, count, distance);
    const entries = hash.entries;
    const entryCellX = hash.entryCellX;
    const entryCellY = hash.entryCellY;

    let blockCellX = NaN;
    let blockCellY = NaN;
    let blockSize = 0;

    for (let e = 0; e < count; e++) {
      const cellX = entryCellX[e];
      const cellY = entryCellY[e];
      if (cellX !== blockCellX || cellY !== blockCellY) {
        blockSize = hash.gatherCellBlock(cellX, cellY, candidates);
        blockCellX = cellX;
        blockCellY = cellY;
      }

      const i = entries[e];
      const x = positions[i * 2];
      const y = positions[i * 2 + 1];
      let cx = 0;
      let cy = 0;

      for (let k = 0; k < blockSize; k++) {
        const j = candidates[k];
        if (j === i) continue;
        const dx = positions[j * 2] - x;
        const dy = positions[j * 2 + 1] - y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= distance2) continue;

        if (d2 > EPSILON) {
          const d = Math.sqrt(d2);
          const push = (distance - d) / (2 * d);
          cx -= dx * push;
          cy -= dy * push;
        } else {
          // Two boids on the same spot have no line between them to push
          // along. The lower index goes left, so the pair splits instead of
          // both moving the same way.
          cx += i < j ? -maxCorrection : maxCorrection;
        }
      }

      const c2 = cx * cx + cy * cy;
      if (c2 > maxCorrection2) {
        const scale = maxCorrection / Math.sqrt(c2);
        cx *= scale;
        cy *= scale;
      }
      corrections[i * 2] = cx;
      corrections[i * 2 + 1] = cy;
    }

    const invDt = 1 / dt;
    for (let k = 0; k < count * 2; k++) {
      positions[k] += corrections[k];
      contactPush[k] += corrections[k] * invDt;
    }
  }

  /** Puts the bands where the flock is now, with no glide. */
  private snapRanges(): void {
    const p = this.params;
    const maxSpeed = Math.max(p.maxSpeed, EPSILON);
    this.rangeState.maxSpeed = maxSpeed;
    this.rangeState.minSpeed = Math.min(Math.max(p.minSpeed, 0), maxSpeed);
    this.rangeState.maxDensity = this.densityTarget;
  }

  /** xorshift32. Advances boid `i`'s own stream and returns `[0, 1)`. */
  private nextNoise(index: number): number {
    let state = this.noise[index];
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.noise[index] = state;
    return (state >>> 0) / 4294967296;
  }

  private scatterOnSpawnDisc(index: number, random: () => number): void {
    const p = this.params;
    // sqrt of a uniform, so the disc fills evenly instead of piling up at the
    // centre.
    const radius = Math.sqrt(random()) * Math.max(p.spawnRadius, 0);
    const angle = random() * TWO_PI;
    this.positions[index * 2] = Math.cos(angle) * radius;
    this.positions[index * 2 + 1] = Math.sin(angle) * radius;

    const heading = random() * TWO_PI;
    const speed = p.minSpeed + random() * Math.max(p.maxSpeed - p.minSpeed, 0);
    this.velocities[index * 2] = Math.cos(heading) * speed;
    this.velocities[index * 2 + 1] = Math.sin(heading) * speed;
  }

  /**
   * Fills slots `[from, to)`, placing each newcomer beside a boid already
   * flying with that boid's velocity turned slightly. Raising the count slider
   * then thickens the flock you are watching instead of firing a clump in from
   * the spawn disc.
   */
  private spawnIntoFlock(from: number, to: number): void {
    const random = this.spawnRandom;
    const spread = Math.max(this.params.separationRadius, EPSILON) * 2;

    for (let i = from; i < to; i++) {
      this.noise[i] = seedNoise(from ^ 0x7f4a7c15, i);
      this.wanderAngles[i] = (random() * 2 - 1) * Math.PI;
      this.densities[i] = 0;
      this.contactPush[i * 2] = 0;
      this.contactPush[i * 2 + 1] = 0;

      if (from === 0) {
        // No flock to join yet.
        this.scatterOnSpawnDisc(i, random);
        continue;
      }

      const parent = Math.min(from - 1, Math.floor(random() * from));
      const angle = random() * TWO_PI;
      const radius = Math.sqrt(random()) * spread;
      this.positions[i * 2] = this.positions[parent * 2] + Math.cos(angle) * radius;
      this.positions[i * 2 + 1] = this.positions[parent * 2 + 1] + Math.sin(angle) * radius;

      const turn = (random() * 2 - 1) * 0.3;
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const vx = this.velocities[parent * 2];
      const vy = this.velocities[parent * 2 + 1];
      this.velocities[i * 2] = vx * cos - vy * sin;
      this.velocities[i * 2 + 1] = vx * sin + vy * cos;
    }
  }

  /**
   * Refreshes the camera's sample. A fixed stride across the flock rather than
   * a prefix, so it stays spread over the whole of it however the count moves.
   */
  private updateSample(): void {
    const sample = this.sampleState;
    const capacity = sample.positions.length / 2;
    const n = Math.min(capacity, this._count);
    sample.count = n;

    if (n === 0) {
      sample.centroid.x = 0;
      sample.centroid.y = 0;
      this.densityTarget = 1;
      return;
    }

    const stride = this._count / n;
    let sumX = 0;
    let sumY = 0;
    let sumDensity = 0;
    let sumDensity2 = 0;
    for (let k = 0; k < n; k++) {
      const i = Math.min(this._count - 1, Math.floor(k * stride));
      const x = this.positions[i * 2];
      const y = this.positions[i * 2 + 1];
      sample.positions[k * 2] = x;
      sample.positions[k * 2 + 1] = y;
      sumX += x;
      sumY += y;
      const density = this.densities[i];
      sumDensity += density;
      sumDensity2 += density * density;
    }
    sample.centroid.x = sumX / n;
    sample.centroid.y = sumY / n;

    // The density band, off the same sampled boids, riding along with a loop
    // the camera already needs. Scanning the whole flock for a statistic
    // nobody reads per boid would be the wrong trade at five thousand.
    const mean = sumDensity / n;
    const variance = Math.max(0, sumDensity2 / n - mean * mean);
    this.densityTarget = Math.max(1, mean + DENSITY_SIGMAS * Math.sqrt(variance));
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function clampCount(count: number, capacity: number): number {
  return Math.min(capacity, Math.max(0, Math.floor(count)));
}

function wrapAngle(angle: number): number {
  if (angle > Math.PI) return angle - TWO_PI;
  if (angle < -Math.PI) return angle + TWO_PI;
  return angle;
}

/** xorshift32 dies on a state of zero, hence the `| 1`. */
function seedNoise(seed: number, index: number): number {
  return (hashSeed((seed + Math.imul(index, 0x9e3779b1)) | 0) | 1) >>> 0;
}

export const createFlock: SimulationFactory = (options) => new Flock(options);
