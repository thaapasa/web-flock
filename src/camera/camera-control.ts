import type { FlockSample } from '../sim/simulation';
import type { CameraSettings } from '../ui/settings';
import type { Camera } from './camera';
import {
  approach,
  fitLogScale,
  flockReach,
  followLogScale,
  FRAME_QUANTILE,
  stepFrame,
  stepZoom,
} from './framing';

/**
 * Follow owns the centre and the zoom together, and only the user turns it off.
 * With it off, the zoom is a plain number and the pointer drags the centre.
 *
 * While following, the zoom you set is a fraction of the flock's size rather
 * than an absolute scale, so the camera keeps that framing as the flock
 * breathes.
 *
 * The centre chases the flock outright, because a centroid of hundreds of boids
 * barely jitters. The zoom cannot: the flock's reach moves every step, and a
 * zoom that answered it would hunt, dragging the grid's decades in and out with
 * it. So it follows through a deadband and a time constant, and only when it
 * must.
 */

/** Decades of zoom per pixel of wheel travel. */
const WHEEL_SENSITIVITY = 0.0016;

/** Decades per keypress. Small enough to walk through a grid decade handover. */
const KEY_ZOOM_STEP = 0.05;

/**
 * How much lazier the zoom is on the way in than on the way out, in deadband
 * and in time constant. If boids are about to leave the screen that is urgent,
 * and empty space around a flock that has drawn itself in is not.
 */
const LAZY_TOLERANCE = 3;
const LAZY_TAU = 3;

export interface CameraControlOptions {
  /** The live camera folder of the settings. The wheel and a fit write to it. */
  settings: CameraSettings;
  /** The flock to frame. An accessor because the active scene can change. */
  sample: () => FlockSample;
  /** The wheel writes to `settings`; this lets the panel catch up. */
  onZoomChanged: () => void;
  /** Whether the pointer and keys currently belong to the camera. */
  active: () => boolean;
}

export interface CameraControl {
  /**
   * Puts the camera where the settings say. Call it once per frame, before
   * drawing, with the seconds since the last call.
   */
  apply(dt: number): void;
  /** Centres on the flock and frames it, dropping any follow zoom back to a plain fit. */
  frameFlock(): void;
  readonly help: string;
  dispose(): void;
}

export function createCameraControl(
  target: HTMLElement,
  camera: Camera,
  options: CameraControlOptions,
): CameraControl {
  const { settings, sample, onZoomChanged, active } = options;

  /** Grown as needed and reused, so a fit allocates nothing. */
  let radii = new Float64Array(256);

  /**
   * The zoom the camera is actually at. While following it lags the framing by
   * up to a deadband, so it is not the same number as either setting.
   */
  let live = settings.logScale;
  let following = settings.follow;
  /** The framing the live zoom was last matched to. */
  let frameLog = settings.frameLog;
  /** Cleared after the first following frame, so the page opens framed rather than gliding in. */
  let snap = settings.follow;

  /**
   * Moves the live zoom with a change to the framing, whether it came from the
   * wheel or from the panel. Asking for a different framing is the user asking
   * to see something now, so it does not wait behind the deadband.
   */
  const syncFrame = (): void => {
    if (settings.frameLog === frameLog) return;
    live = stepZoom(live, frameLog - settings.frameLog);
    frameLog = settings.frameLog;
  };

  const zoomBy = (decades: number): void => {
    if (settings.follow) {
      // Zooming in shows less of the flock, so the fraction moves the other way.
      settings.frameLog = stepFrame(settings.frameLog, -decades);
      syncFrame();
    } else {
      settings.logScale = stepZoom(settings.logScale, decades);
    }
    onZoomChanged();
  };

  const onWheel = (event: WheelEvent): void => {
    if (!active()) return;
    event.preventDefault();
    // deltaMode 0 is pixels, 1 is lines, 2 is pages. A trackpad sends pixels and
    // a mouse wheel sends lines, so without this the mouse would barely move.
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    zoomBy(-event.deltaY * scale * WHEEL_SENSITIVITY);
  };

  let dragging = 0;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (event: PointerEvent): void => {
    // Follow owns the centre, so a drag would be a tug of war the frame loop wins.
    if (event.button !== 0 || settings.follow || !active()) return;
    dragging = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    target.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (dragging !== event.pointerId) return;
    const perPixel = camera.worldPerPixel;
    // Drag the world, not the camera, so the ground follows the pointer. Screen y
    // runs down, which flips that sign.
    camera.setCenter(
      camera.center.x - (event.clientX - lastX) * perPixel,
      camera.center.y + (event.clientY - lastY) * perPixel,
    );
    lastX = event.clientX;
    lastY = event.clientY;
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (dragging !== event.pointerId) return;
    dragging = 0;
    target.releasePointerCapture(event.pointerId);
  };

  const frameFlock = (): void => {
    const flock = sample();
    if (flock.count === 0) return;
    if (flock.count > radii.length) radii = new Float64Array(flock.count);

    camera.setCenter(flock.centroid.x, flock.centroid.y);
    live = fitLogScale(
      flockReach(flock, FRAME_QUANTILE, radii),
      camera.viewportWidth,
      camera.viewportHeight,
    );
    // Asked for by a key or a button, so it lands now rather than easing in.
    if (settings.follow) {
      settings.frameLog = 0;
      frameLog = 0;
    } else {
      settings.logScale = live;
    }
    onZoomChanged();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey || !active()) return;

    switch (event.key) {
      case 'z':
        frameFlock();
        break;
      case '+':
      case '=':
        zoomBy(KEY_ZOOM_STEP);
        break;
      case '-':
        zoomBy(-KEY_ZOOM_STEP);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  target.addEventListener('wheel', onWheel, { passive: false });
  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('keydown', onKeyDown);

  return {
    apply(dt: number): void {
      if (settings.follow !== following) {
        following = settings.follow;
        // Hand the zoom over rather than jump: the view you were looking at
        // while following is the one the plain zoom starts from.
        if (!following) {
          settings.logScale = live;
          onZoomChanged();
        }
      }

      if (following) {
        syncFrame();
        const flock = sample();
        if (flock.count > 0) {
          camera.setCenter(flock.centroid.x, flock.centroid.y);
          if (flock.count > radii.length) radii = new Float64Array(flock.count);

          const wanted = followLogScale(
            flockReach(flock, FRAME_QUANTILE, radii),
            camera.viewportWidth,
            camera.viewportHeight,
            settings.frameLog,
          );
          // Above the live zoom is a zoom in, which is the lazy direction.
          const lazy = wanted > live;
          live = snap
            ? wanted
            : approach(
                live,
                wanted,
                settings.zoomTolerance * (lazy ? LAZY_TOLERANCE : 1),
                settings.zoomTau * (lazy ? LAZY_TAU : 1),
                dt,
              );
          snap = false;
        }
      } else {
        live = settings.logScale;
      }

      // Cheap every frame: the setter compares before it marks the transform dirty.
      camera.logScale = live;
    },

    frameFlock,

    get help() {
      return settings.follow ? 'wheel zoom · z frame' : 'wheel zoom · drag pan · z frame';
    },

    dispose(): void {
      target.removeEventListener('wheel', onWheel);
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
