import type { Simulation } from '../sim/simulation';
import { GLError } from './gl';

/**
 * Where a boid has just been, and what it was doing there.
 *
 * The ribbon trail needs several past samples *per boid*, and a vertex shader
 * cannot reach them through vertex attributes: an attribute is indexed by
 * instance or by vertex, never by both, and twenty of them would exhaust the
 * attribute slots several times over. So history goes in a texture — one
 * column per boid, one row per recorded sample — and the shader reads it with
 * `texelFetch`, which is an ordinary indexed load and needs no filtering.
 *
 * It is a **ring**: each capture overwrites the oldest row rather than
 * shifting anything, so recording a sample for five thousand boids is one
 * upload of one row, and {@link newest} says where the front of the queue is.
 *
 * Each texel is `(x, y, speed, density)`. Position is what the ribbon is
 * threaded through; the other two are what it is *coloured* by, and they have
 * to be recorded rather than read from the boid's current state — otherwise a
 * trail is one flat colour that changes along its whole length at once, which
 * says where the boid is now and nothing about where it has been. Recorded,
 * the trail becomes a history of the flight: a boid that just accelerated
 * drags a cooler tail behind a hot nose.
 *
 * Capture is on a fixed cadence tied to simulation steps, never once per
 * frame. A trail is a length of *time* — half a second of flight — and a trail
 * that recorded one sample per frame would be half as long on a machine
 * rendering at 30 fps as on one at 60.
 *
 * This implementation uploads from the CPU, matching `createUploadFeed`. The
 * seam for a GPU backend is the same shape as the feed's: the texture layout
 * and the shader do not change, and the upload becomes a `copyBufferSubData`
 * into a staging buffer followed by a `texSubImage2D` out of
 * `PIXEL_UNPACK_BUFFER` — GPU to GPU, with nothing read back.
 */

/**
 * Rows in the texture, and so the longest trail any style may ask for. At the
 * capture cadence in `app.ts` this is a little under a second of flight.
 */
export const MAX_TRAIL_POINTS = 24;

/** `(x, y, speed, density)` per sample. */
const CHANNELS = 4;

export interface TrailHistory {
  readonly texture: WebGLTexture;
  /** Rows held. A style's `trailPoints` is clamped to this. */
  readonly rows: number;
  /** The row holding the most recent capture. Walk backwards from here. */
  readonly newest: number;
  /** Records the current state of every boid as the newest sample. */
  capture(): void;
  /**
   * Fills every row for boids `[from, to)` with where they are now, collapsing
   * their trails to a point.
   *
   * Called when the flock is reset and when the count rises. A slot that has
   * just been handed to a new boid still holds the path of whoever had it
   * last, and without this the newcomer arrives trailing a streak from
   * somewhere it has never been.
   */
  seed(from: number, to: number): void;
  dispose(): void;
}

/** History for a backend that produces CPU-side arrays: upload them. */
export function createUploadTrailHistory(
  gl: WebGL2RenderingContext,
  simulation: Simulation,
  rows: number = MAX_TRAIL_POINTS,
): TrailHistory {
  const width = simulation.capacity;
  const height = Math.max(1, Math.floor(rows));

  const texture = gl.createTexture();
  if (!texture) throw new GLError('Could not create the trail history texture');

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
  // Nothing here is ever filtered or wrapped: every read is a texelFetch at an
  // exact integer coordinate. A 32-bit float texture is not filterable without
  // an extension anyway, so NEAREST is the only honest setting.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);

  /** One row, interleaved for the upload. Reused; never handed out. */
  const staging = new Float32Array(width * CHANNELS);
  let newest = 0;

  const gather = (from: number, to: number): void => {
    const { positions, velocities, densities } = simulation;
    for (let i = from; i < to; i++) {
      const vx = velocities[i * 2];
      const vy = velocities[i * 2 + 1];
      const at = i * CHANNELS;
      staging[at] = positions[i * 2];
      staging[at + 1] = positions[i * 2 + 1];
      staging[at + 2] = Math.sqrt(vx * vx + vy * vy);
      staging[at + 3] = densities[i];
    }
  };

  const upload = (from: number, to: number, row: number): void => {
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      from,
      row,
      to - from,
      1,
      gl.RGBA,
      gl.FLOAT,
      staging.subarray(from * CHANNELS, to * CHANNELS),
    );
  };

  const history: TrailHistory = {
    texture,
    rows: height,

    get newest() {
      return newest;
    },

    capture(): void {
      const live = Math.min(width, simulation.count);
      if (live === 0) return;
      newest = (newest + 1) % height;
      // Only the boids that exist. Slots past `count` hold whatever their last
      // occupant left, and nothing draws them until `seed` gives them a
      // present — walking them here would be five thousand square roots a
      // capture in a flock of two hundred and fifty.
      gather(0, live);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      upload(0, live, newest);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },

    seed(from: number, to: number): void {
      const start = Math.max(0, Math.floor(from));
      const end = Math.min(width, Math.floor(to));
      if (end <= start) return;

      gather(start, end);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      for (let row = 0; row < height; row++) upload(start, end, row);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },

    dispose(): void {
      gl.deleteTexture(texture);
    },
  };

  // Nothing has a past yet, and an unwritten texture is full of zeroes — which
  // would trail every boid back to the origin on the first frame.
  history.seed(0, width);
  return history;
}
