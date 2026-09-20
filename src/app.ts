import { Camera } from './camera/camera';
import { createBoidControls } from './dev/boid-controls';
import { createGridControls } from './dev/grid-controls';
import { createPoseTrack } from './dev/pose-track';
import type { Vec2 } from './math/types';
import type { BoidFeed } from './render/boid-feed';
import { createUploadFeed } from './render/boid-feed';
import type { BoidTarget } from './render/boids';
import { createBoidRenderer } from './render/boids';
import { createResizingCanvas } from './render/canvas';
import { createFrameStats } from './render/frame-stats';
import type { ViewportRect } from './render/gl';
import { getContext } from './render/gl';
import { createGridRenderer } from './render/grid';
import type { OverlayOptions } from './render/overlay';
import { createOverlay, DEFAULT_OVERLAY_OPTIONS } from './render/overlay';
import type { TrailHistory } from './render/trail-history';
import { createUploadTrailHistory } from './render/trail-history';
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
 * Steps 5 and 6 plug in here — controls, camera behaviour — which is why the
 * wiring is a module rather than the body of `main`.
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

/**
 * Simulation steps between trail captures: 30 Hz against the 120 Hz step.
 *
 * Tied to steps and not to frames on purpose. A trail is a length of *time*,
 * and one sample per frame would make it half as long on a machine rendering
 * at 30 fps as on one at 60 — the trail would get shorter exactly when the
 * thing it is drawn on got slower.
 */
const TRAIL_CAPTURE_STEPS = 4;

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

/**
 * A simulation and everything the renderer needs to draw it.
 *
 * There are two: the flock, and step 4a's design harness. They are whole
 * scenes rather than a switch inside the renderer because that is what makes
 * the harness worth anything — it goes through the same feed, the same trail
 * history and the same draw calls as the real thing, so a mark that looks
 * right there is not looking right by special arrangement.
 */
interface Scene {
  readonly simulation: Simulation;
  readonly feed: BoidFeed;
  readonly trails: TrailHistory;
  readonly target: BoidTarget;
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

  const grid = createGridRenderer(gl);
  const boids = createBoidRenderer(gl);

  const createScene = (simulation: Simulation): Scene => {
    const feed = createUploadFeed(gl, simulation);
    const trails = createUploadTrailHistory(gl, simulation);
    const target = boids.bind(feed, trails, simulation.ranges);
    return {
      simulation,
      feed,
      trails,
      target,
      dispose(): void {
        target.dispose();
        trails.dispose();
        feed.dispose();
      },
    };
  };

  const live = createScene(createFlock({ capacity, params, seed: options.seed ?? 1 }));
  const design = createScene(createPoseTrack());

  const overlayOptions: OverlayOptions = { ...DEFAULT_OVERLAY_OPTIONS };
  const overlay = createOverlay(overlayElement, overlayOptions);

  // Temporary: a zoom to scroll, a camera to move, and the presets behind both
  // comparison modes. Replaced by the real controls in step 5 — see `dev/`.
  // The boids' half is created first because it owns the switch that decides
  // which of the two the number keys belong to.
  const boidControls = createBoidControls(camera);
  const controls = createGridControls(
    sceneElement,
    camera,
    overlayOptions,
    () => !boidControls.focused,
  );

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
  let stepsSinceCapture = 0;
  let active: Scene = live;

  const frame = (nowMs: number): void => {
    const now = nowMs / 1000;
    const frameMs = (now - previous) * 1000;
    accumulator += Math.min(now - previous, MAX_FRAME_TIME);
    previous = now;

    const scene = boidControls.designing ? design : live;
    if (scene !== active) {
      active = scene;
      // The scene that was paused holds history from whenever it last ran, and
      // the one taking over may never have run at all. Collapse the trails to
      // where the boids are now rather than streaking in from the past.
      scene.trails.seed(0, scene.simulation.capacity);
    }

    // Re-projected every frame rather than on the pointer event: the camera
    // moves under a stationary pointer, and the world point beneath it moves
    // with it.
    if (cursorOverCanvas) camera.screenToWorld(cursorScreenX, cursorScreenY, cursor);
    input.cursor = cursorOverCanvas ? cursor : null;

    let steps = 0;
    let simMs = 0;
    while (accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
      // Timed per step rather than around the loop, so the trail upload below
      // does not land in the simulation's number and make it look slow.
      const stepStarted = performance.now();
      scene.simulation.step(FIXED_STEP, input);
      simMs += performance.now() - stepStarted;

      accumulator -= FIXED_STEP;
      steps++;

      // Inside the loop, not after it: a frame that runs several steps has
      // several moments to record, and recording them all from the last one
      // would bunch the trail up.
      if (++stepsSinceCapture >= TRAIL_CAPTURE_STEPS) {
        stepsSinceCapture = 0;
        scene.trails.capture();
      }
    }
    // Still owed time after the cap: write it off rather than spiral. See
    // MAX_STEPS_PER_FRAME.
    const behind = accumulator >= FIXED_STEP;
    if (behind) accumulator = 0;
    stats.record(frameMs, simMs, steps, behind);

    // Once per frame, after the steps: see BoidFeed.sync.
    scene.feed.sync();

    const { deviceWidth, deviceHeight, pixelRatio } = surface.size;
    gl.clear(gl.COLOR_BUFFER_BIT);

    // At most one of these is ever set: each half of the controls hands out
    // quadrants only while the number keys belong to it.
    const gridPanes = controls.quadrants;
    const boidPanes = boidControls.quadrants;
    const panes = gridPanes ?? boidPanes;

    if (panes) {
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
      for (let i = 0; i < panes.length; i++) {
        rect.x = columns[i % 2];
        rect.y = rows[Math.floor(i / 2)];
        rect.width = widths[i % 2];
        rect.height = heights[Math.floor(i / 2)];
        // The grid is opaque and covers its rect, so it goes under the boids
        // in every pane rather than once for the whole frame.
        grid.draw(camera, pixelRatio, gridPanes?.[i].style ?? controls.style, rect);
        boids.draw(
          scene.target,
          camera,
          pixelRatio,
          boidPanes?.[i].style ?? boidControls.style,
          rect,
        );
      }
    } else {
      rect.x = 0;
      rect.y = 0;
      rect.width = deviceWidth;
      rect.height = deviceHeight;
      grid.draw(camera, pixelRatio, controls.style, rect);
      boids.draw(scene.target, camera, pixelRatio, boidControls.style, rect);
    }
    // The draws leave their last quadrant as the viewport; hand the full buffer
    // back for whatever comes next.
    gl.viewport(0, 0, deviceWidth, deviceHeight);

    overlay.draw({
      camera,
      cursor: cursorOverCanvas ? cursor : null,
      style: gridPanes ? gridPanes[0].style : controls.style,
      boid: {
        styleName: (boidPanes ? boidPanes[0].style : boidControls.style).name,
        count: scene.feed.count,
      },
      quadrants: panes ? panes.map((pane) => pane.caption) : null,
      help: boidControls.focused ? boidControls.help : `${controls.help} · ${boidControls.hint}`,
      stats: stats.current,
    });

    frameHandle = requestAnimationFrame(frame);
  };

  return {
    camera,
    simulation: live.simulation,
    feed: live.feed,

    setParams(next: Readonly<SimParams>): void {
      const before = live.simulation.count;
      live.simulation.setParams(next);
      // New boids are placed beside boids already flying, so they have a
      // present but no past; without this they arrive trailing whatever the
      // last occupant of their slot was doing.
      if (live.simulation.count > before) live.trails.seed(before, live.simulation.count);
    },

    reset(seed: number): void {
      live.simulation.reset(seed);
      live.trails.seed(0, live.simulation.capacity);
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
      boidControls.dispose();
      overlay.dispose();
      design.dispose();
      live.dispose();
      boids.dispose();
      grid.dispose();
      surface.dispose();
    },
  };
}
