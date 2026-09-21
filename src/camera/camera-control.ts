import type { FlockSample } from '../sim/simulation';
import type { CameraSettings } from '../ui/settings';
import type { Camera } from './camera';
import { fitLogScale, flockReach, FRAME_QUANTILE, stepZoom } from './framing';

/**
 * Follow and zoom are independent. Follow moves the centre and never touches
 * zoom, and only the user turns follow off.
 */

/** Decades of zoom per pixel of wheel travel. */
const WHEEL_SENSITIVITY = 0.0016;

/** Decades per keypress. Small enough to walk through a grid decade handover. */
const KEY_ZOOM_STEP = 0.05;

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
  /** Puts the camera where the settings say. Call it once per frame, before drawing. */
  apply(): void;
  /** Centres on the flock and zooms to fit it, once. */
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

  const zoomBy = (decades: number): void => {
    settings.logScale = stepZoom(settings.logScale, decades);
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
    settings.logScale = fitLogScale(
      flockReach(flock, FRAME_QUANTILE, radii),
      camera.viewportWidth,
      camera.viewportHeight,
    );
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
    apply(): void {
      // Cheap every frame: the setter compares before it marks the transform dirty.
      camera.logScale = settings.logScale;
      if (!settings.follow) return;

      const flock = sample();
      if (flock.count > 0) camera.setCenter(flock.centroid.x, flock.centroid.y);
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
