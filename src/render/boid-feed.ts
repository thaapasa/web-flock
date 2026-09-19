import type { Simulation } from '../sim/simulation';
import { createBuffer } from './gl';

/**
 * How per-boid data reaches the GPU.
 *
 * This is the other half of the seam described in `sim/simulation.ts`, and it
 * lives here rather than there because it is a rendering concern: a simulation
 * computes, it does not draw.
 *
 * Splitting it this way is what keeps a future GPU backend a drop-in. The CPU
 * backend produces typed arrays and {@link createUploadFeed} uploads them. A
 * GPU backend would implement both `Simulation` and `BoidFeed`, returning the
 * buffer it just computed into; its `sync` would do nothing and nothing would
 * ever be read back off the GPU. The renderer binds a `BoidFeed` either way and
 * cannot tell the difference.
 */

/** Describes one per-instance attribute well enough for the renderer to bind it. */
export interface VertexAttributeSource {
  readonly buffer: WebGLBuffer;
  /** Components per boid. */
  readonly size: 1 | 2 | 3 | 4;
  /** A `gl.*` type enum, e.g. `gl.FLOAT`. */
  readonly type: number;
  /** Bytes between consecutive boids. 0 means tightly packed. */
  readonly stride: number;
  /** Byte offset of boid 0. */
  readonly offset: number;
}

/**
 * The buffers the renderer binds, one element per boid, boid `i` at index `i`
 * in every one of them. Valid after {@link BoidFeed.sync}; the renderer must
 * not write to them.
 *
 * Trails are deliberately absent. Whether a trail is a ring buffer of past
 * positions or a quad stretched along the velocity is decided in step 4a, and
 * either way it is built on top of this: a history can be accumulated by
 * copying `position` into a ring of buffers with `copyBufferSubData`, which
 * costs the same whichever backend filled it.
 */
export interface BoidFeed {
  readonly position: VertexAttributeSource;
  readonly velocity: VertexAttributeSource;
  /** Instances to draw. Valid after {@link sync}. */
  readonly count: number;
  /**
   * Brings the buffers up to date with the simulation. Called once per frame,
   * not once per simulation step — with a 120 Hz fixed step against a 60 Hz
   * display, uploading per step would do the work twice and throw half of it
   * away. Cheap to call when nothing has moved.
   */
  sync(): void;
  dispose(): void;
}

/** A feed for a backend that produces CPU-side arrays: upload them. */
export function createUploadFeed(gl: WebGL2RenderingContext, simulation: Simulation): BoidFeed {
  const bytes = simulation.capacity * 2 * Float32Array.BYTES_PER_ELEMENT;
  const positionBuffer = createBuffer(gl, gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);
  const velocityBuffer = createBuffer(gl, gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);

  const attribute = (buffer: WebGLBuffer): VertexAttributeSource => ({
    buffer,
    size: 2,
    type: gl.FLOAT,
    stride: 0,
    offset: 0,
  });

  let uploadedRevision = -1;
  let count = 0;

  return {
    position: attribute(positionBuffer),
    velocity: attribute(velocityBuffer),

    get count() {
      return count;
    },

    sync(): void {
      if (simulation.revision === uploadedRevision) return;
      uploadedRevision = simulation.revision;
      count = simulation.count;
      const elements = count * 2;

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, simulation.positions, 0, elements);
      gl.bindBuffer(gl.ARRAY_BUFFER, velocityBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, simulation.velocities, 0, elements);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    },

    dispose(): void {
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(velocityBuffer);
    },
  };
}
