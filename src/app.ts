import { Camera } from './camera/camera';
import type { Vec2 } from './math/types';
import type { BoidFeed } from './render/boid-feed';
import { createUploadFeed } from './render/boid-feed';
import { createResizingCanvas } from './render/canvas';
import { getContext } from './render/gl';
import { createFlock } from './sim/flock';
import type { SimParams } from './sim/params';
import { DEFAULT_SIM_PARAMS } from './sim/params';
import type { SimInput, Simulation } from './sim/simulation';

/**
 * The orchestrator.
 *
 * It owns the pieces and the frame loop, and is the only place that knows the
 * pieces exist in the same program: the canvas, the GL context, the camera, the
 * simulation, and the feed that carries the simulation's output to the GPU.
 * Everything it assembles is independently testable because none of them refer
 * to each other.
 *
 * Steps 3 to 6 plug in here — grid, boid renderer, controls, camera behaviour —
 * which is why the wiring is a module rather than the body of `main`.
 */

/** Seconds per simulation step. 120 Hz, so a 60 fps frame is two steps. */
const FIXED_STEP = 1 / 120;

/**
 * Longest real interval a single frame is allowed to advance the simulation.
 * A backgrounded tab returns with an enormous elapsed time; without this the
 * accumulator would try to catch up and lock the page solid.
 */
const MAX_FRAME_TIME = 0.25;

export interface AppOptions {
  /** Upper bound on boid count; sizes the simulation's arrays. */
  capacity?: number;
  params?: Readonly<SimParams>;
  seed?: number;
}

export interface App {
  readonly camera: Camera;
  readonly simulation: Simulation;
  readonly feed: BoidFeed;
  /** Live parameters. Takes effect on the next step, with no restart. */
  setParams(params: Readonly<SimParams>): void;
  /** Restarts the flock from a seeded state, leaving parameters alone. */
  reset(seed: number): void;
  start(): void;
  stop(): void;
  dispose(): void;
}

export function createApp(canvasElement: HTMLCanvasElement, options: AppOptions = {}): App {
  const params = options.params ?? DEFAULT_SIM_PARAMS;
  const capacity = options.capacity ?? Math.max(1, Math.floor(params.count));

  const surface = createResizingCanvas(canvasElement);
  const gl = getContext(canvasElement);

  const camera = new Camera({
    logScale: 0,
    viewportWidth: surface.size.width,
    viewportHeight: surface.size.height,
  });

  const simulation = createFlock({ capacity, params, seed: options.seed ?? 1 });
  const feed = createUploadFeed(gl, simulation);

  const applySize = (): void => {
    const { width, height, deviceWidth, deviceHeight } = surface.size;
    camera.setViewport(width, height);
    gl.viewport(0, 0, deviceWidth, deviceHeight);
  };
  const stopWatchingSize = surface.onResize(applySize);
  applySize();

  // Tracked in world space so it stays put under the flock when the camera
  // moves, rather than sliding with the screen.
  const cursor: Vec2 = { x: 0, y: 0 };
  let cursorOverCanvas = false;

  const onPointerMove = (event: PointerEvent): void => {
    const rect = canvasElement.getBoundingClientRect();
    camera.screenToWorld(event.clientX - rect.left, event.clientY - rect.top, cursor);
    cursorOverCanvas = true;
  };
  const onPointerLeave = (): void => {
    cursorOverCanvas = false;
  };
  canvasElement.addEventListener('pointermove', onPointerMove);
  canvasElement.addEventListener('pointerleave', onPointerLeave);

  const input: SimInput = { cursor: null };

  gl.clearColor(0, 0, 0, 1);

  let frameHandle = 0;
  let running = false;
  let previous = 0;
  let accumulator = 0;

  const frame = (nowMs: number): void => {
    const now = nowMs / 1000;
    accumulator += Math.min(now - previous, MAX_FRAME_TIME);
    previous = now;

    input.cursor = cursorOverCanvas ? cursor : null;
    while (accumulator >= FIXED_STEP) {
      simulation.step(FIXED_STEP, input);
      accumulator -= FIXED_STEP;
    }

    // Once per frame, after the steps: see BoidFeed.sync.
    feed.sync();

    gl.clear(gl.COLOR_BUFFER_BIT);
    // Nothing draws yet. The grid arrives in step 3, the boids in 4a and 4b.

    frameHandle = requestAnimationFrame(frame);
  };

  return {
    camera,
    simulation,
    feed,

    setParams(next: Readonly<SimParams>): void {
      simulation.setParams(next);
    },

    reset(seed: number): void {
      simulation.reset(seed);
    },

    start(): void {
      if (running) return;
      running = true;
      previous = performance.now() / 1000;
      accumulator = 0;
      frameHandle = requestAnimationFrame(frame);
    },

    stop(): void {
      if (!running) return;
      running = false;
      cancelAnimationFrame(frameHandle);
    },

    dispose(): void {
      this.stop();
      canvasElement.removeEventListener('pointermove', onPointerMove);
      canvasElement.removeEventListener('pointerleave', onPointerLeave);
      stopWatchingSize();
      surface.dispose();
      feed.dispose();
    },
  };
}
