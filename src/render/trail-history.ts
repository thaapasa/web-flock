import type { Simulation } from '../sim/simulation';
import { GLError } from './gl';

/**
 * Recent samples for every boid, in a texture: one column per boid, one row per
 * sample, each texel `(x, y, speed, density)`. A vertex shader cannot reach a
 * boid's past through attributes, because an attribute is indexed by instance
 * or by vertex and never by both, so the trail shader reads this with
 * `texelFetch`.
 *
 * The rows are a ring. Each capture overwrites the oldest row instead of
 * shifting anything, and `newest` says which row that is.
 *
 * Speed and density are recorded per sample rather than read from the boid's
 * current state. Read live, a trail is one flat colour that changes along its
 * whole length at once; recorded, a boid that just accelerated drags a cooler
 * tail behind a hot nose.
 */

/** Rows in the texture, and so the longest trail any style may ask for. */
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
   * their trails to a point. Call it on reset and when the count rises: a slot
   * just handed to a new boid still holds the path of whoever had it last.
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
  // Every read is a texelFetch at an exact texel, so nothing is ever filtered
  // or wrapped. A 32-bit float texture is not filterable without an extension
  // anyway.
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
      // Only the boids that exist. Slots past `count` keep whatever their last
      // occupant left, nothing draws them until `seed` runs, and gathering them
      // would cost a square root each every capture.
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

  // An unwritten texture is all zeroes, which would trail every boid back to
  // the origin on the first frame.
  history.seed(0, width);
  return history;
}
