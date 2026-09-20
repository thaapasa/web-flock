import { Camera } from './camera/camera';
import { createGridControls } from './dev/grid-controls';
import type { Vec2 } from './math/types';
import type { BoidFeed } from './render/boid-feed';
import { createUploadFeed } from './render/boid-feed';
import { createResizingCanvas } from './render/canvas';
import { createFrameStats } from './render/frame-stats';
import { getContext } from './render/gl';
import type { ViewportRect } from './render/grid';
import { createGridRenderer } from './render/grid';
import type { OverlayOptions } from './render/overlay';
import { createOverlay, DEFAULT_OVERLAY_OPTIONS } from './render/overlay';
import { createFlock } from './sim/flock';
import type { SimParams } from './sim/params';
import { DEFAULT_SIM_PARAMS } from './sim/params';
import type { SimInput, Simulation } from './sim/simulation';

/**
 * The orchestrator.
 *
 * It owns the pieces and the frame loop, and is the only place that knows the
 * pieces exist in the same program: the canvases, the GL context, the camera,
 * the simulation, and the feed that carries the simulation's output to the GPU.
 * Everything it assembles is independently testable because none of them refer
 * to each other.
 *
 * Steps 4 to 6 plug in here — boid renderer, controls, camera behaviour — which
 * is why the wiring is a module rather than the body of `main`.
 */

/** Seconds per simulation step. 120 Hz, so a 60 fps frame is two steps. */
const FIXED_STEP = 1 / 120;

/**
 * Longest real interval a single frame is allowed to advance the simulation.
 * A backgrounded tab returns with an enormous elapsed time; without this the
 * accumulator would try to catch up and lock the page solid.
 */
const MAX_FRAME_TIME = 0.25;

/**
 * Most steps one frame may run before the rest of the debt is written off.
 *
 * Without a cap, a fixed timestep behind a slow step does not degrade — it
 * spirals. Steps that overrun make the frame longer, a longer frame owes more
 * steps, and the next frame overruns further; the page locks up hard from what
 * began as a mild overload. Dropping the debt trades exactness for that: when
 * the simulation cannot keep up, it runs in slow motion and the page stays
 * responsive, which is the right failure for something whose point is to be
 * looked at. The HUD says `behind` when it happens rather than hiding it.
 *
 * Four covers a 30 Hz display honestly (120 Hz fixed step, four steps a
 * frame); 60 Hz needs two.
 */
const MAX_STEPS_PER_FRAME = 5;

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

export function createApp(
  sceneElement: HTMLCanvasElement,
  overlayElement: HTMLCanvasElement,
  options: AppOptions = {},
): App {
  const params = options.params ?? DEFAULT_SIM_PARAMS;
  const capacity = options.capacity ?? Math.max(1, Math.floor(params.count));

  const surface = createResizingCanvas(sceneElement);
  const gl = getContext(sceneElement);

  const camera = new Camera({
    logScale: 0,
    viewportWidth: surface.size.width,
    viewportHeight: surface.size.height,
  });

  const simulation = createFlock({ capacity, params, seed: options.seed ?? 1 });
  const feed = createUploadFeed(gl, simulation);

  const grid = createGridRenderer(gl);
  const overlayOptions: OverlayOptions = { ...DEFAULT_OVERLAY_OPTIONS };
  const overlay = createOverlay(overlayElement, overlayOptions);

  // Temporary: a zoom to scroll and a camera to move, so the grid can be
  // looked at. Replaced by the real controls in step 5 — see dev/grid-controls.
  const controls = createGridControls(sceneElement, camera, overlayOptions);

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
  let cursorScreenX = 0;
  let cursorScreenY = 0;
  let cursorOverCanvas = false;

  const onPointerMove = (event: PointerEvent): void => {
    const rect = sceneElement.getBoundingClientRect();
    cursorScreenX = event.clientX - rect.left;
    cursorScreenY = event.clientY - rect.top;
    cursorOverCanvas = true;
  };
  const onPointerLeave = (): void => {
    cursorOverCanvas = false;
  };
  sceneElement.addEventListener('pointermove', onPointerMove);
  sceneElement.addEventListener('pointerleave', onPointerLeave);

  const input: SimInput = { cursor: null };

  gl.clearColor(0, 0, 0, 1);

  const stats = createFrameStats();

  /** Reused each frame; the grid's rects are the only allocation-prone part. */
  const rect: ViewportRect = { x: 0, y: 0, width: 1, height: 1 };

  let frameHandle = 0;
  let running = false;
  let previous = 0;
  let accumulator = 0;

  const frame = (nowMs: number): void => {
    const now = nowMs / 1000;
    const frameMs = (now - previous) * 1000;
    accumulator += Math.min(now - previous, MAX_FRAME_TIME);
    previous = now;

    // Re-projected every frame rather than on the pointer event: the camera
    // moves under a stationary pointer, and the world point beneath it moves
    // with it.
    if (cursorOverCanvas) camera.screenToWorld(cursorScreenX, cursorScreenY, cursor);
    input.cursor = cursorOverCanvas ? cursor : null;

    const simStarted = performance.now();
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
      simulation.step(FIXED_STEP, input);
      accumulator -= FIXED_STEP;
      steps++;
    }
    // Still owed time after the cap: write it off rather than spiral. See
    // MAX_STEPS_PER_FRAME.
    const behind = accumulator >= FIXED_STEP;
    if (behind) accumulator = 0;
    stats.record(frameMs, performance.now() - simStarted, steps, behind);

    // Once per frame, after the steps: see BoidFeed.sync.
    feed.sync();

    const { deviceWidth, deviceHeight, pixelRatio } = surface.size;
    gl.clear(gl.COLOR_BUFFER_BIT);

    const quadrants = controls.quadrants;
    if (quadrants) {
      // Four variants of the same view, in one frame. Each quadrant is its own
      // GL viewport at the same camera and the same scale, so the only thing
      // that differs between them is the style — which is what makes one look
      // enough to choose from.
      const splitX = Math.floor(deviceWidth / 2);
      const splitY = Math.floor(deviceHeight / 2);
      const columns = [0, splitX];
      const widths = [splitX, deviceWidth - splitX];
      // Reading order, so quadrant 1 is top-left; GL's y runs the other way.
      const rows = [splitY, 0];
      const heights = [deviceHeight - splitY, splitY];
      for (let i = 0; i < quadrants.length; i++) {
        rect.x = columns[i % 2];
        rect.y = rows[Math.floor(i / 2)];
        rect.width = widths[i % 2];
        rect.height = heights[Math.floor(i / 2)];
        grid.draw(camera, pixelRatio, quadrants[i].style, rect);
      }
    } else {
      rect.x = 0;
      rect.y = 0;
      rect.width = deviceWidth;
      rect.height = deviceHeight;
      grid.draw(camera, pixelRatio, controls.style, rect);
    }
    // The grid leaves its last quadrant as the viewport; hand the full buffer
    // back for whatever draws next.
    gl.viewport(0, 0, deviceWidth, deviceHeight);

    // The boids arrive in step 4b, between the grid and the overlay.

    overlay.draw({
      camera,
      cursor: cursorOverCanvas ? cursor : null,
      style: quadrants ? quadrants[0].style : controls.style,
      quadrants: quadrants ? quadrants.map((quadrant) => quadrant.caption) : null,
      help: controls.help,
      stats: stats.current,
    });

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
      sceneElement.removeEventListener('pointermove', onPointerMove);
      sceneElement.removeEventListener('pointerleave', onPointerLeave);
      stopWatchingSize();
      controls.dispose();
      overlay.dispose();
      grid.dispose();
      surface.dispose();
      feed.dispose();
    },
  };
}
