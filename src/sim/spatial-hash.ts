/**
 * A uniform spatial hash over an unbounded plane.
 *
 * Neighbour search is the whole cost of flocking: every boid asks "who is near
 * me" once per step, 5,000 times at 120 Hz. Done naively that is quadratic and
 * hopeless, so boids are bucketed into square cells the size of the query
 * radius and each query only looks at the 3x3 block of cells around itself.
 *
 * Three decisions worth stating, because all three are places this is usually
 * got wrong:
 *
 * - **The plane is unbounded**, so cell coordinates are unbounded integers and
 *   cannot index an array directly. They are hashed into a fixed table, which
 *   means two distant cells can share a bucket. Every entry therefore carries
 *   its real cell coordinates and lookups check them. Without that check a
 *   collision does not merely add far-away candidates that the distance test
 *   would reject — it makes a lookup visit the same bucket twice and count some
 *   neighbours twice, which silently biases every average in the simulation.
 *
 * - **Rebuilt from scratch every step**, by counting sort into flat typed
 *   arrays. No per-cell arrays, no `Map`, nothing allocated after
 *   construction. Incremental update would be faster in principle and is not
 *   worth the bookkeeping at this scale.
 *
 * - **The 3x3 walk is offered per cell, not only per boid.** Every boid in a
 *   cell has the same candidates, and there are on the order of ten boids to a
 *   cell, so walking the block once and reusing it is most of the difference
 *   between hitting 60fps and not. {@link gatherCellBlock} is the primitive;
 *   {@link queryNeighbours} is it plus a distance test.
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
   * Largest number of entries in any one bucket after the last build.
   *
   * A perf canary. The predicted failure mode (step 8) is the flock compressing
   * into a single cell, at which point every lookup degenerates to a scan of
   * the whole flock; this is the number that says so before the framerate does.
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
   * Collects every boid in the 3x3 block of cells centred on
   * `(cellX, cellY)` into `out`, and returns how many there were.
   *
   * This is the traversal — which cells, which entries, and the check that
   * rejects a foreign cell sharing a bucket. Everything that searches the hash
   * goes through it, so there is one place for that logic to be right.
   *
   * The result is a superset of any neighbourhood inside the cell: callers
   * still apply their own distance test, and `out` includes the boids of the
   * centre cell, so a caller looking for a boid's neighbours must skip itself.
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
   * This is what the tests compare against brute force. The simulation does not
   * call it — it gathers a block once per cell and shares it across the boids
   * in that cell — but the part that could plausibly be wrong, the traversal,
   * is {@link gatherCellBlock} and is common to both. What is left here is a
   * distance test, in plain sight.
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
