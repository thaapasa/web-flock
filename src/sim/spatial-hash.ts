/**
 * A uniform spatial hash over an unbounded plane. Boids go into square cells
 * the size of the query radius, so a query only looks at the 3x3 block of cells
 * around itself.
 *
 * The plane is unbounded, so cell coordinates cannot index an array and are
 * hashed into a fixed table instead. Two distant cells can then share a bucket,
 * so every entry carries its real cell coordinates and lookups check them.
 * Without that check a lookup visits the same bucket twice and counts some
 * neighbours twice, which quietly biases every average in the simulation.
 *
 * The index is rebuilt from scratch every step, by counting sort into flat
 * typed arrays with nothing allocated after construction. Incremental update
 * would be faster in principle and is not worth the bookkeeping at this scale.
 */

function nextPowerOfTwo(value: number): number {
  let n = 1;
  while (n < value) n *= 2;
  return n;
}

export class SpatialHash {
  readonly capacity: number;

  /**
   * Bucket `b` owns `entries[cellStart[b] .. cellStart[b + 1])`. Length is
   * `tableSize + 1`, so the last bucket needs no special case.
   */
  readonly cellStart: Int32Array;
  /** Boid indices, ordered by bucket. */
  readonly entries: Int32Array;
  /** The real cell of `entries[k]`, for rejecting foreign cells in a bucket. */
  readonly entryCellX: Int32Array;
  readonly entryCellY: Int32Array;

  private readonly mask: number;
  private readonly cursor: Int32Array;
  private readonly boidBucket: Int32Array;
  private readonly boidCellX: Int32Array;
  private readonly boidCellY: Int32Array;
  private readonly blockScratch: Int32Array;

  private _cellSize = 1;
  private _invCellSize = 1;
  private _count = 0;
  private _maxBucketSize = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
    // Twice the boid count keeps the table sparse enough that collisions are
    // rare, at four bytes a slot.
    const tableSize = nextPowerOfTwo(Math.max(16, this.capacity * 2));
    this.mask = tableSize - 1;

    this.cellStart = new Int32Array(tableSize + 1);
    this.cursor = new Int32Array(tableSize);
    this.entries = new Int32Array(this.capacity);
    this.entryCellX = new Int32Array(this.capacity);
    this.entryCellY = new Int32Array(this.capacity);
    this.boidBucket = new Int32Array(this.capacity);
    this.boidCellX = new Int32Array(this.capacity);
    this.boidCellY = new Int32Array(this.capacity);
    this.blockScratch = new Int32Array(this.capacity);
  }

  /** Boids in the last build. */
  get count(): number {
    return this._count;
  }

  get cellSize(): number {
    return this._cellSize;
  }

  /**
   * Largest number of entries in any one bucket after the last build. It shows
   * the flock compressing into one cell, where every lookup degenerates into a
   * scan of the whole flock, before the framerate does.
   */
  get maxBucketSize(): number {
    return this._maxBucketSize;
  }

  /** The cell coordinate of one world axis value. */
  cellCoord(worldValue: number): number {
    return Math.floor(worldValue * this._invCellSize);
  }

  /** The bucket a cell hashes into. */
  bucket(cellX: number, cellY: number): number {
    return (Math.imul(cellX, 0x9e3779b1) ^ Math.imul(cellY, 0x85ebca6b)) & this.mask;
  }

  /**
   * Rebuilds the index. `cellSize` should be the largest radius that will be
   * queried, so that a 3x3 block of cells is guaranteed to contain every
   * neighbour.
   */
  build(positions: Float32Array, count: number, cellSize: number): void {
    const n = Math.max(0, Math.min(Math.floor(count), this.capacity));
    this._count = n;
    this._cellSize = cellSize > 0 ? cellSize : 1;
    this._invCellSize = 1 / this._cellSize;

    const { cellStart, cursor, entries, entryCellX, entryCellY } = this;
    const { boidBucket, boidCellX, boidCellY } = this;
    const tableSize = this.mask + 1;

    cellStart.fill(0);

    // Counts land at `b + 1` so that the prefix sum below can run in place.
    for (let i = 0; i < n; i++) {
      const cx = this.cellCoord(positions[i * 2]);
      const cy = this.cellCoord(positions[i * 2 + 1]);
      boidCellX[i] = cx;
      boidCellY[i] = cy;
      const b = this.bucket(cx, cy);
      boidBucket[i] = b;
      cellStart[b + 1]++;
    }

    let maxBucketSize = 0;
    for (let b = 0; b < tableSize; b++) {
      const size = cellStart[b + 1];
      if (size > maxBucketSize) maxBucketSize = size;
      cellStart[b + 1] = cellStart[b] + size;
    }
    this._maxBucketSize = maxBucketSize;

    cursor.set(cellStart.subarray(0, tableSize));
    for (let i = 0; i < n; i++) {
      const k = cursor[boidBucket[i]]++;
      entries[k] = i;
      entryCellX[k] = boidCellX[i];
      entryCellY[k] = boidCellY[i];
    }
  }

  /**
   * Collects every boid in the 3x3 block of cells centred on `(cellX, cellY)`
   * into `out`, and returns how many there were.
   *
   * Everything that searches the hash goes through this, so the traversal and
   * the check that rejects a foreign cell sharing a bucket live in one place.
   * A block is offered per cell rather than per boid because every boid in a
   * cell has the same candidates, and there are on the order of ten of them.
   *
   * The result is a superset: a caller applies its own distance test, and `out`
   * holds the centre cell too, so a caller looking for a boid's neighbours must
   * skip that boid itself.
   */
  gatherCellBlock(cellX: number, cellY: number, out: Int32Array): number {
    const { cellStart, entries, entryCellX, entryCellY } = this;
    const limit = out.length;
    let found = 0;

    for (let gy = cellY - 1; gy <= cellY + 1; gy++) {
      for (let gx = cellX - 1; gx <= cellX + 1; gx++) {
        const bucket = this.bucket(gx, gy);
        const end = cellStart[bucket + 1];
        for (let k = cellStart[bucket]; k < end; k++) {
          // A foreign cell sharing this bucket. Skipping it here is what keeps
          // the result free of duplicates.
          if (entryCellX[k] !== gx || entryCellY[k] !== gy) continue;
          out[found++] = entries[k];
          if (found === limit) return found;
        }
      }
    }
    return found;
  }

  /**
   * Collects every boid within `radius` of boid `index`, excluding it, into
   * `out`. Returns how many were found.
   *
   * `radius` must not exceed the `cellSize` the hash was built with, or the
   * block searched is too small and neighbours go missing.
   *
   * The tests compare this against brute force. The simulation gathers a block
   * once per cell instead, but both share `gatherCellBlock`, which is the part
   * that could plausibly be wrong. What is left here is a distance test.
   */
  queryNeighbours(positions: Float32Array, index: number, radius: number, out: Int32Array): number {
    const candidates = this.blockScratch;
    const x = positions[index * 2];
    const y = positions[index * 2 + 1];
    const found = this.gatherCellBlock(this.cellCoord(x), this.cellCoord(y), candidates);
    const radius2 = radius * radius;

    let kept = 0;
    for (let k = 0; k < found; k++) {
      const j = candidates[k];
      if (j === index) continue;
      const dx = positions[j * 2] - x;
      const dy = positions[j * 2 + 1] - y;
      if (dx * dx + dy * dy > radius2) continue;
      out[kept++] = j;
      if (kept === out.length) break;
    }
    return kept;
  }
}
