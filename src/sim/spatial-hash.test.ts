import { describe, expect, it } from 'vitest';

import { createRandom } from '../math/rng';
import { SpatialHash } from './spatial-hash';

/** The definition of the right answer. */
function bruteForceNeighbours(
  positions: Float32Array,
  count: number,
  index: number,
  radius: number,
): number[] {
  const x = positions[index * 2];
  const y = positions[index * 2 + 1];
  const radius2 = radius * radius;
  const found: number[] = [];
  for (let j = 0; j < count; j++) {
    if (j === index) continue;
    const dx = positions[j * 2] - x;
    const dy = positions[j * 2 + 1] - y;
    if (dx * dx + dy * dy <= radius2) found.push(j);
  }
  return found;
}

function hashNeighbours(
  hash: SpatialHash,
  positions: Float32Array,
  index: number,
  radius: number,
  capacity: number,
): number[] {
  const out = new Int32Array(capacity);
  const found = hash.queryNeighbours(positions, index, radius, out);
  return Array.from(out.subarray(0, found));
}

/**
 * Compares every boid's neighbour set against brute force, and insists the
 * hash's answer contains no duplicates — a bucket collision that made a query
 * visit the same cell twice would still pass a set comparison.
 */
function expectMatchesBruteForce(
  positions: Float32Array,
  count: number,
  radius: number,
  capacity = count,
): void {
  const hash = new SpatialHash(capacity);
  hash.build(positions, count, radius);

  for (let i = 0; i < count; i++) {
    const actual = hashNeighbours(hash, positions, i, radius, capacity);
    expect(new Set(actual).size, `boid ${i} was given a neighbour twice`).toBe(actual.length);
    expect([...actual].sort(numerically), `boid ${i}`).toEqual(
      bruteForceNeighbours(positions, count, i, radius).sort(numerically),
    );
  }
}

const numerically = (a: number, b: number): number => a - b;

function scatter(count: number, extent: number, seed: number): Float32Array {
  const random = createRandom(seed);
  const positions = new Float32Array(count * 2);
  for (let i = 0; i < count * 2; i++) positions[i] = (random() * 2 - 1) * extent;
  return positions;
}

describe('SpatialHash', () => {
  it('returns the same neighbour set as brute force for a scattered flock', () => {
    expectMatchesBruteForce(scatter(400, 200, 1), 400, 24);
  });

  it('agrees with brute force at several radii', () => {
    const positions = scatter(300, 120, 7);
    for (const radius of [1, 5, 24, 60, 400]) {
      expectMatchesBruteForce(positions, 300, radius);
    }
  });

  it('agrees when the whole flock is compressed into one cell', () => {
    // The step 8 failure mode: correctness must survive it even if speed does.
    // Shifted clear of the axes: a clump straddling them would be split across
    // four cells and would not be the case under test.
    const positions = scatter(250, 2, 11);
    for (let i = 0; i < positions.length; i++) positions[i] += 20;
    expectMatchesBruteForce(positions, 250, 50);

    const hash = new SpatialHash(250);
    hash.build(positions, 250, 50);
    expect(hash.maxBucketSize).toBe(250);
  });

  it('agrees far from the origin, where cell coordinates are large and negative', () => {
    const positions = scatter(200, 150, 3);
    for (let i = 0; i < 200; i++) {
      positions[i * 2] -= 900_000;
      positions[i * 2 + 1] -= 1_500_000;
    }
    expectMatchesBruteForce(positions, 200, 24);
  });

  it('keeps distant cells apart when they share a bucket', () => {
    // A small table against a wide spread of cells, so collisions are certain
    // rather than hoped for. Without the per-entry cell check this fails by
    // returning neighbours from the far side of the world.
    const count = 64;
    const positions = scatter(count, 5_000, 23);
    expectMatchesBruteForce(positions, count, 10, count);
  });

  it('indexes only the first `count` boids', () => {
    const positions = scatter(100, 50, 5);
    expectMatchesBruteForce(positions, 40, 24, 100);
  });

  it('gathers exactly the 3x3 block of cells around a cell', () => {
    // The traversal everything else is built on, checked directly rather than
    // only through the distance test that usually hides its mistakes.
    const count = 300;
    const positions = scatter(count, 150, 17);
    const cellSize = 24;
    const hash = new SpatialHash(count);
    hash.build(positions, count, cellSize);

    const out = new Int32Array(count);
    const cells = new Set<string>();
    for (let i = 0; i < count; i++) {
      cells.add(`${hash.cellCoord(positions[i * 2])},${hash.cellCoord(positions[i * 2 + 1])}`);
    }

    for (const cell of cells) {
      const [cellX, cellY] = cell.split(',').map(Number);
      const found = hash.gatherCellBlock(cellX, cellY, out);
      const actual = Array.from(out.subarray(0, found));

      const expected: number[] = [];
      for (let j = 0; j < count; j++) {
        const dx = hash.cellCoord(positions[j * 2]) - cellX;
        const dy = hash.cellCoord(positions[j * 2 + 1]) - cellY;
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) expected.push(j);
      }

      expect(new Set(actual).size, `cell ${cell} yielded a boid twice`).toBe(actual.length);
      expect([...actual].sort(numerically), `cell ${cell}`).toEqual(expected.sort(numerically));
    }
  });

  it('survives an empty flock', () => {
    const hash = new SpatialHash(16);
    hash.build(new Float32Array(32), 0, 10);
    expect(hash.count).toBe(0);
    expect(hash.maxBucketSize).toBe(0);
  });
});
