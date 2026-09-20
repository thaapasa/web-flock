import { Camera } from './camera/camera';
import type { CameraControl } from './camera/camera-control';
import { createCameraControl } from './camera/camera-control';
import { createReadingLog, describeRenderer } from './dev/readings';
import { createStyleKeys } from './dev/style-keys';
import type { Vec2 } from './math/types';
import type { BoidFeed } from './render/boid-feed';
import { createUploadFeed } from './render/boid-feed';
import { createBoidRenderer } from './render/boids';
import { createResizingCanvas } from './render/canvas';
import { createFrameStats } from './render/frame-stats';
import type { ViewportRect } from './render/gl';
import { getContext } from './render/gl';
import type { CursorRing } from './render/grid';
import { createGridRenderer } from './render/grid';
import type { OverlayOptions } from './render/overlay';
import { createOverlay, DEFAULT_OVERLAY_OPTIONS } from './render/overlay';
import { createUploadTrailHistory } from './render/trail-history';
import { createFlock } from './sim/flock';
import type { SimInput, Simulation } from './sim/simulation';
import type { Panel } from './ui/panel';
import { createPanel } from './ui/panel';
import type { Settings } from './ui/settings';
import {
  boidStyle,
  copyInto,
  cursorRadius,
  defaultSettings,
  exportLiteral,
  gridStyle,
  parse,
  serialise,
  simParams,
} from './ui/settings';
import type { SettingsStorage } from './ui/storage';
import { createLocalStorage } from './ui/storage';

/**
 * The orchestrator.
 *
 * It owns the pieces and the frame loop, and is the only place that knows the
 * pieces exist in the same program: the canvases, the GL context, the camera,
 * the simulation, the feed that carries the simulation's output to the GPU,
 * and — since step 5 — the settings every one of them reads from.
 *
 * The settings are the shape of the program now. One object holds everything
 * the user can change; the panel mutates it, the wheel and the preset keys
 * mutate it, and this file is the only thing that turns it into a simulation
 * parameter set, a pair of styles and a camera. Nothing downstream keeps a
 * copy, so there is no state to get out of step.
 *
 * Step 6 plugs in here — the damping that makes the camera comfortable — which
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

/**
 * Simulation steps between trail captures: 30 Hz against the 120 Hz step.
 *
 * Tied to steps and not to frames on purpose. A trail is a length of *time*,
 * and one sample per frame would make it half as long on a machine rendering
 * at 30 fps as on one at 60 — the trail would get shorter exactly when the
 * thing it is drawn on got slower.
 */
const TRAIL_CAPTURE_STEPS = 4;

/**
 * How many boids the arrays are sized for.
 *
 * Step 4b's target, and the top of the count slider: the arrays are allocated
 * once and the slider must be able to reach five thousand without a restart.
 * All of it together is under two megabytes.
 */
const DEFAULT_CAPACITY = 5000;

/**
 * How long a change waits before it is written to storage.
 *
 * Dragging a slider fires a change per frame, and a flock is tuned by dragging.
 * Long enough that a drag writes once at the end, short enough that a change
 * followed by a closed tab is almost always kept — and `pagehide` catches the
 * rest.
 */
const SAVE_DELAY_MS = 400;

export interface AppOptions {
  /** Upper bound on boid count; sizes the simulation's arrays once. */
  capacity?: number;
  seed?: number;
  /** Where settings are kept between visits. Defaults to `localStorage`. */
  storage?: SettingsStorage;
}

export interface App {
  readonly camera: Camera;
  readonly simulation: Simulation;
  readonly feed: BoidFeed;
  /**
   * Everything the user can change, live. Mutate it and call {@link apply};
   * the panel does exactly that.
   */
  readonly settings: Settings;
  /** Pushes the settings into the simulation and the overlay. No restart. */
  apply(): void;
  /** Restarts the flock from a seeded state, leaving the settings alone. */
  reset(seed: number): void;
  start(): void;
  stop(): void;
  dispose(): void;
}

export function createApp(
  sceneElement: HTMLCanvasElement,
  overlayElement: HTMLCanvasElement,
  panelElement: HTMLElement,
  options: AppOptions = {},
): App {
  const storage = options.storage ?? createLocalStorage();
  const settings = parse(storage.read());
  const capacity = Math.max(options.capacity ?? DEFAULT_CAPACITY, Math.floor(settings.flock.count));
  let seed = options.seed ?? 1;

  const surface = createResizingCanvas(sceneElement);
  const gl = getContext(sceneElement);

  const camera = new Camera({
    logScale: 0,
    viewportWidth: surface.size.width,
    viewportHeight: surface.size.height,
  });

  const grid = createGridRenderer(gl);
  const boids = createBoidRenderer(gl);

  const simulation = createFlock({ capacity, params: simParams(settings), seed });
  const feed = createUploadFeed(gl, simulation);
  const trails = createUploadTrailHistory(gl, simulation);
  const target = boids.bind(feed, trails, simulation.ranges);

  const overlayOptions: OverlayOptions = { ...DEFAULT_OVERLAY_OPTIONS };
  const overlay = createOverlay(overlayElement, overlayOptions);

  const stats = createFrameStats();

  /**
   * Pushes the settings everywhere they have to go.
   *
   * Cheap enough to call on every step of a slider drag, which is what it gets:
   * `setParams` stores the values and precomputes nothing, and the styles are
   * read straight from the settings by the frame loop. The only part that does
   * real work is a count that has grown, and only for the boids that are new.
   */
  const apply = (): void => {
    const before = simulation.count;
    simulation.setParams(simParams(settings));
    // New boids are placed beside boids already flying, so they have a present
    // but no past; without this they arrive trailing whatever the last occupant
    // of their slot was doing.
    if (simulation.count > before) trails.seed(before, simulation.count);

    overlayOptions.placement = settings.look.labels;
    overlayOptions.format = settings.look.labelFormat;
  };

  let saveHandle: ReturnType<typeof setTimeout> | null = null;

  const save = (): void => {
    if (saveHandle !== null) {
      clearTimeout(saveHandle);
      saveHandle = null;
    }
    storage.write(serialise(settings));
  };

  /** See SAVE_DELAY_MS. */
  const scheduleSave = (): void => {
    if (saveHandle !== null) clearTimeout(saveHandle);
    saveHandle = setTimeout(save, SAVE_DELAY_MS);
  };

  const onPageHide = (): void => {
    if (saveHandle !== null) save();
  };
  window.addEventListener('pagehide', onPageHide);

  const readings = createReadingLog(describeRenderer(gl));

  /** The HUD, as one block of text that survives being pasted. */
  const dumpReadings = (): void => {
    const stat = stats.current;
    const { width, height, pixelRatio } = surface.size;
    const style = boidStyle(settings.look);
    const table = readings.add({
      boids: feed.count,
      trails: style.trail !== 'none',
      fps: stat.fps,
      frameMs: stat.frameMs,
      worstMs: stat.worstFrameMs,
      simMs: stat.simMs,
      steps: stat.steps,
      behind: stat.behind,
      scale: camera.scale,
      band: simulation.ranges.maxDensity,
      settings: {
        viewport: `${Math.round(width)}x${Math.round(height)} @${pixelRatio.toFixed(2)}x`,
        style: style.name,
        trailPoints: style.trailPoints,
        blend: style.blend,
        floorFade: style.floorFade,
        neighbourRadius: settings.flock.neighbourRadius,
        separationRadius: settings.flock.separationRadius,
        minSpeed: settings.flock.minSpeed,
        maxSpeed: settings.flock.maxSpeed,
      },
    });
    // One string, not an object: a console renders an object as a tree that
    // copies back as something nobody can read.
    console.log(table);
  };

  // One forward reference: the camera refreshes the panel when the wheel
  // writes to the settings, and the panel asks the camera to frame the flock.
  // Both stand down while a Tweakpane field has the keyboard, because every
  // global key in this app is a bare letter.
  let panel: Panel | null = null;
  const panelHasKeys = (): boolean => panel?.capturesKeys === true;

  const cameraControl: CameraControl = createCameraControl(sceneElement, camera, {
    settings: settings.camera,
    sample: () => simulation.sample,
    onZoomChanged: () => {
      panel?.refresh();
      scheduleSave();
    },
    active: () => !panelHasKeys(),
  });

  panel = createPanel({
    container: panelElement,
    settings,
    capacity,
    hooks: {
      apply: (committed: boolean): void => {
        apply();
        if (committed) scheduleSave();
      },
      frameFlock: () => cameraControl.frameFlock(),
      restart: () => {
        simulation.reset(seed);
        trails.seed(0, simulation.capacity);
      },
      exportSettings: () => {
        console.log(exportLiteral(settings));
      },
      reset: () => {
        storage.clear();
        // In place: the panel is bound to the objects inside `settings`.
        copyInto(settings, defaultSettings());
        apply();
        panel?.refresh();
      },
    },
  });

  const styleKeys = createStyleKeys(
    settings,
    {
      changed: () => {
        panel?.refresh();
        scheduleSave();
      },
      dumpReadings,
      clearReadings: () => readings.clear(),
    },
    () => !panelHasKeys(),
  );

  const applySize = (): void => {
    const { width, height, deviceWidth, deviceHeight } = surface.size;
    camera.setViewport(width, height);
    gl.viewport(0, 0, deviceWidth, deviceHeight);
  };
  const stopWatchingSize = surface.onResize(applySize);
  applySize();
  apply();

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

  /** Reused each frame; the grid's rects are the only allocation-prone part. */
  const rect: ViewportRect = { x: 0, y: 0, width: 1, height: 1 };
  /** Reused each frame. Fields are readonly to the renderer, not to us. */
  const ring: { x: number; y: number; radius: number } = { x: 0, y: 0, radius: 0 };

  let frameHandle = 0;
  let running = false;
  let previous = 0;
  let accumulator = 0;
  let stepsSinceCapture = 0;

  const frame = (nowMs: number): void => {
    const now = nowMs / 1000;
    const frameMs = (now - previous) * 1000;
    accumulator += Math.min(now - previous, MAX_FRAME_TIME);
    previous = now;

    // Re-projected every frame rather than on the pointer event: the camera
    // moves under a stationary pointer, and the world point beneath it moves
    // with it.
    if (cursorOverCanvas) camera.screenToWorld(cursorScreenX, cursorScreenY, cursor);
    // A cursor doing nothing is handed over as no cursor at all, so the step
    // skips the distance test for every boid rather than multiplying by zero.
    const pushing = cursorOverCanvas && settings.cursor.mode !== 'nothing';
    input.cursor = pushing ? cursor : null;

    let steps = 0;
    let simMs = 0;
    while (accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
      // Timed per step rather than around the loop, so the trail upload below
      // does not land in the simulation's number and make it look slow.
      const stepStarted = performance.now();
      simulation.step(FIXED_STEP, input);
      simMs += performance.now() - stepStarted;

      accumulator -= FIXED_STEP;
      steps++;

      // Inside the loop, not after it: a frame that runs several steps has
      // several moments to record, and recording them all from the last one
      // would bunch the trail up.
      if (++stepsSinceCapture >= TRAIL_CAPTURE_STEPS) {
        stepsSinceCapture = 0;
        trails.capture();
      }
    }
    // Still owed time after the cap: write it off rather than spiral. See
    // MAX_STEPS_PER_FRAME.
    const behind = accumulator >= FIXED_STEP;
    if (behind) accumulator = 0;
    stats.record(frameMs, simMs, steps, behind);

    // After the steps, so the camera frames where the flock is now rather than
    // where it was last frame. Undamped on purpose — that is step 6.
    cameraControl.apply();

    // Once per frame, after the steps: see BoidFeed.sync.
    feed.sync();

    const { deviceWidth, deviceHeight, pixelRatio } = surface.size;
    gl.clear(gl.COLOR_BUFFER_BIT);

    const gridLook = gridStyle(settings.look);
    const boidLook = boidStyle(settings.look);

    const reach = pushing ? cursorRadius(settings) : 0;
    let cursorRing: CursorRing | null = null;
    if (reach > 0) {
      ring.x = cursor.x;
      ring.y = cursor.y;
      ring.radius = reach;
      cursorRing = ring;
    }

    // At most one of these is ever set: the digits drive one preset list at a
    // time, and `b` says which.
    const gridPanes = styleKeys.gridQuadrants;
    const boidPanes = styleKeys.boidQuadrants;
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
        grid.draw(camera, pixelRatio, gridPanes?.[i].style ?? gridLook, rect, cursorRing);
        boids.draw(target, camera, pixelRatio, boidPanes?.[i].style ?? boidLook, rect);
      }
    } else {
      rect.x = 0;
      rect.y = 0;
      rect.width = deviceWidth;
      rect.height = deviceHeight;
      grid.draw(camera, pixelRatio, gridLook, rect, cursorRing);
      boids.draw(target, camera, pixelRatio, boidLook, rect);
    }
    // The draws leave their last quadrant as the viewport; hand the full buffer
    // back for whatever comes next.
    gl.viewport(0, 0, deviceWidth, deviceHeight);

    overlay.draw({
      camera,
      cursor: cursorOverCanvas ? cursor : null,
      cursorMode: pushing ? settings.cursor.mode : '',
      follow: settings.camera.follow,
      style: gridPanes ? gridPanes[0].style : gridLook,
      boid: {
        styleName: (boidPanes ? boidPanes[0].style : boidLook).name,
        count: feed.count,
      },
      quadrants: panes ? panes.map((pane) => pane.caption) : null,
      help: `${cameraControl.help} · ${styleKeys.help}`,
      stats: stats.current,
    });

    frameHandle = requestAnimationFrame(frame);
  };

  return {
    camera,
    simulation: simulation,
    feed: feed,
    settings,

    apply,

    reset(nextSeed: number): void {
      seed = nextSeed;
      simulation.reset(seed);
      trails.seed(0, simulation.capacity);
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
      onPageHide();
      window.removeEventListener('pagehide', onPageHide);
      sceneElement.removeEventListener('pointermove', onPointerMove);
      sceneElement.removeEventListener('pointerleave', onPointerLeave);
      stopWatchingSize();
      styleKeys.dispose();
      panel?.dispose();
      cameraControl.dispose();
      overlay.dispose();
      target.dispose();
      trails.dispose();
      feed.dispose();
      boids.dispose();
      grid.dispose();
      surface.dispose();
    },
  };
}
