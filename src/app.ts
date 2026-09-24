import { Camera } from './camera/camera';
import type { CameraControl } from './camera/camera-control';
import { createCameraControl } from './camera/camera-control';
import { createReadingLog, describeRenderer } from './dev/readings';
import type { Vec2 } from './math/types';
import type { BoidFeed } from './render/boid-feed';
import { createUploadFeed } from './render/boid-feed';
import { createBoidRenderer } from './render/boids';
import { createResizingCanvas } from './render/canvas';
import { createFrameStats } from './render/frame-stats';
import { getContext } from './render/gl';
import type { CursorRing } from './render/grid';
import { createGridRenderer } from './render/grid';
import type { OverlayOptions } from './render/overlay';
import { createOverlay, DEFAULT_OVERLAY_OPTIONS } from './render/overlay';
import { createUploadTrailHistory } from './render/trail-history';
import { createFlock } from './sim/flock';
import type { SimInput, Simulation } from './sim/simulation';
import { createAppKeys } from './ui/keys';
import type { Panel } from './ui/panel';
import { createPanel } from './ui/panel';
import type { Settings } from './ui/settings';
import {
  boidStyle,
  copyInto,
  cursorRadius,
  defaultSettings,
  exportLiteral,
  flockPresetName,
  gridStyle,
  parse,
  serialise,
  simParams,
} from './ui/settings';
import type { SettingsStorage } from './ui/storage';
import { createLocalStorage } from './ui/storage';

/**
 * Builds the program and runs its frame loop.
 *
 * `createApp` creates the pieces in dependency order, `frame` at the bottom is
 * where they meet, and `dispose` takes them down again.
 */

/** Seconds per simulation step. 120 Hz, so a 60 fps frame is two steps. */
const FIXED_STEP = 1 / 120;

/**
 * Longest real interval one frame may advance the simulation. A backgrounded
 * tab comes back with an enormous elapsed time, and without this the
 * accumulator would try to catch up on all of it.
 */
const MAX_FRAME_TIME = 0.25;

/**
 * Most steps one frame may run. Past this it drops the time it still owes. A
 * 60 Hz display needs two steps a frame and a 30 Hz one four.
 */
const MAX_STEPS_PER_FRAME = 5;

/** Simulation steps between trail captures: 30 Hz against the 120 Hz step. */
const TRAIL_CAPTURE_STEPS = 4;

/**
 * Boids the arrays are sized for. They are allocated once, so this is also the
 * top of the count slider.
 */
const DEFAULT_CAPACITY = 5000;

/**
 * How long a change waits before it is written to storage. A slider drag fires
 * a change per frame, so this makes it write once, at the end.
 */
const SAVE_DELAY_MS = 400;

export interface AppOptions {
  /** Sizes the simulation's arrays once. The count can never go above it. */
  capacity?: number;
  seed?: number;
  /** Where settings are kept between visits. Defaults to `localStorage`. */
  storage?: SettingsStorage;
}

export interface App {
  readonly camera: Camera;
  readonly simulation: Simulation;
  readonly feed: BoidFeed;
  /** Everything the user can change. Mutate it and call `apply`. */
  readonly settings: Settings;
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

  /** Cheap enough to call on every step of a slider drag, which is what it gets. */
  const apply = (): void => {
    const before = simulation.count;
    simulation.setParams(simParams(settings));
    // A new boid reuses a slot, so without this it arrives trailing whatever
    // the last occupant of that slot was doing.
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

  const scheduleSave = (): void => {
    if (saveHandle !== null) clearTimeout(saveHandle);
    saveHandle = setTimeout(save, SAVE_DELAY_MS);
  };

  const onPageHide = (): void => {
    if (saveHandle !== null) save();
  };
  window.addEventListener('pagehide', onPageHide);

  const readings = createReadingLog(describeRenderer(gl));

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
        contactDistance: settings.flock.contactDistance,
        minSpeed: settings.flock.minSpeed,
        maxSpeed: settings.flock.maxSpeed,
      },
    });
    // One string, not an object: the console renders an object as a tree that
    // pastes back as something nobody can read.
    console.log(table);
  };

  // The camera refreshes the panel and the panel asks the camera to frame the
  // flock, so one of them has to be declared before the other is built. Both
  // stand down while a Tweakpane field has the keyboard, because every global
  // key here is unmodified.
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

  const keys = createAppKeys(
    settings,
    {
      // After the refresh, because the panel puts the set back as it was and
      // the simulation has to be given that set, not the rounded one the
      // refresh briefly leaves behind.
      changed: () => {
        panel?.refresh();
        apply();
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

  // World space, so the cursor stays over the same boids when the camera moves.
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

  /** Reused each frame. The renderer sees these fields as readonly; we do not. */
  const ring: { x: number; y: number; radius: number } = { x: 0, y: 0, radius: 0 };

  let frameHandle = 0;
  let running = false;
  let previous = 0;
  let accumulator = 0;
  let stepsSinceCapture = 0;

  const frame = (nowMs: number): void => {
    const now = nowMs / 1000;
    const frameMs = (now - previous) * 1000;
    const dt = Math.min(now - previous, MAX_FRAME_TIME);
    accumulator += dt;
    previous = now;

    // Re-projected every frame, not on the pointer event: the camera moves
    // under a still pointer, and the world point beneath it moves with it.
    if (cursorOverCanvas) camera.screenToWorld(cursorScreenX, cursorScreenY, cursor);
    // A cursor set to push nothing is passed as null, so the step skips the
    // distance test for every boid instead of multiplying by zero.
    const pushing = cursorOverCanvas && settings.cursor.mode !== 'nothing';
    input.cursor = pushing ? cursor : null;

    let steps = 0;
    let simMs = 0;
    while (accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
      // Timed per step, not around the loop, so the trail capture below does
      // not count as simulation time.
      const stepStarted = performance.now();
      simulation.step(FIXED_STEP, input);
      simMs += performance.now() - stepStarted;

      accumulator -= FIXED_STEP;
      steps++;

      // Inside the loop: a frame that runs several steps has several moments
      // to record, and taking them all from the last one bunches the trail up.
      if (++stepsSinceCapture >= TRAIL_CAPTURE_STEPS) {
        stepsSinceCapture = 0;
        trails.capture();
      }
    }
    const behind = accumulator >= FIXED_STEP;
    if (behind) accumulator = 0;
    stats.record(frameMs, simMs, steps, behind);

    // After the steps, so the camera frames where the flock is now.
    cameraControl.apply(dt);

    // After the last step and before any draw; see BoidFeed.sync.
    feed.sync();

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

    grid.draw(camera, surface.size, gridLook, cursorRing);
    boids.draw(target, camera, surface.size, boidLook);

    overlay.draw({
      camera,
      cursor: cursorOverCanvas ? cursor : null,
      cursorMode: pushing ? settings.cursor.mode : '',
      follow: settings.camera.follow,
      style: gridLook,
      boid: { styleName: boidLook.name, count: feed.count },
      flock: flockPresetName(settings.flock),
      help: `${cameraControl.help} · ${keys.help}`,
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
      keys.dispose();
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
