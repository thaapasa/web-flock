import { createBuffer } from '../render/gl';
import type { SimParams } from './params';
import type {
  FlockSample,
  SimBuffers,
  SimInput,
  SimulationFactory,
  VertexAttributeSource,
} from './simulation';

/**
 * A backend that allocates everything and simulates nothing.
 *
 * It exists to hold the seam open until step 2 fills it in: the renderer, the
 * camera and the UI can all be built and run against this, and if they work
 * here they will work against any backend. Boids sit at the origin with zero
 * velocity, which is a perfectly valid flock of extremely calm boids.
 */
export const createNullSimulation: SimulationFactory = (gl, options) => {
  const capacity = Math.max(1, Math.floor(options.capacity));
  const sampleSize = Math.max(1, Math.min(options.sampleSize ?? 256, capacity));

  const bytesPerVec2 = 2 * Float32Array.BYTES_PER_ELEMENT;
  const positionBuffer = createBuffer(
    gl,
    gl.ARRAY_BUFFER,
    capacity * bytesPerVec2,
    gl.DYNAMIC_DRAW,
  );
  const velocityBuffer = createBuffer(
    gl,
    gl.ARRAY_BUFFER,
    capacity * bytesPerVec2,
    gl.DYNAMIC_DRAW,
  );

  const attribute = (buffer: WebGLBuffer): VertexAttributeSource => ({
    buffer,
    size: 2,
    type: gl.FLOAT,
    stride: 0,
    offset: 0,
  });

  const buffers: SimBuffers = {
    position: attribute(positionBuffer),
    velocity: attribute(velocityBuffer),
  };

  const centroid = { x: 0, y: 0 };
  const sample: FlockSample = {
    positions: new Float32Array(sampleSize * 2),
    count: sampleSize,
    centroid,
  };

  let count = Math.min(capacity, Math.max(0, Math.floor(options.params.count)));

  return {
    capacity,
    get count() {
      return count;
    },
    buffers,
    sample,

    step(_dt: number, _input: SimInput): void {
      // Nothing moves yet.
    },

    setParams(params: Readonly<SimParams>): void {
      count = Math.min(capacity, Math.max(0, Math.floor(params.count)));
    },

    reset(_seed: number): void {
      // Already at rest.
    },

    dispose(): void {
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(velocityBuffer);
    },
  };
};
