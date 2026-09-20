import type { FlockSample } from '../sim/simulation';
import type { CameraSettings } from '../ui/settings';
import type { Camera } from './camera';
import { fitLogScale, flockReach, FRAME_QUANTILE, stepZoom } from './framing';

/**
 * Everything that moves the camera.
 *
 * Two controls, and they are deliberately independent. **Follow** decides
 * whether the centre tracks the flock; it is a checkbox nothing else ever
 * touches, so there is no state machine to be surprised by — PLAN.md rules one
 * out and this is not one. **Zoom** is a number the camera holds until the
 * wheel, a key or a fit changes it, and follow does not touch it at all.
 *
 * Zoom was briefly derived from the flock's spread, which is what PLAN.md asks
 * for, and it hunted: see `framing.ts`. A continuously derived zoom needs step
 * 6's hysteresis under it, so what is here holds still instead.
 *
 * What is otherwise *not* here is step 6: this snaps. With follow on the centre
 * jumps to the flock's centroid every frame with no damping at all, and making
 * that comfortable is the whole of the next step.
 */

/** Decades of zoom per pixel of wheel travel. */
const WHEEL_SENSITIVITY = 0.0016;

/**
 * Decades per keypress, for stepping through a grid handover frame by frame.
 *
 * Step 3 wanted this to check that no line pops at a decade boundary, and it is
 * still the only way to look at one slowly. The keys survive the panel.
 */
const KEY_ZOOM_STEP = 0.05;

export interface CameraControlOptions {
  /** The live camera folder of the settings. Mutated by the wheel and by a fit. */
  settings: CameraSettings;
  /** The flock to frame. An accessor because the active scene can change. */
  sample: () => FlockSample;
  /** The wheel writes to `settings`; this lets the panel catch up. */
  onZoomChanged: () => void;
  /** Whether the pointer and keys currently belong to the camera. */
  active: () => boolean;
}

export interface CameraControl {
  /** Puts the camera where the settings say. Once per frame, before drawing. */
  apply(): void;
  /** Centres on the flock and zooms to fit it. One shot — see `framing.ts`. */
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
    // deltaMode 0 is pixels, 1 is lines, 2 is pages. A trackpad sends small
    // pixel deltas and a mouse wheel sends line deltas, so without this a
    // mouse would move a hundred times less than a trackpad.
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    zoomBy(-event.deltaY * scale * WHEEL_SENSITIVITY);
  };

  let dragging = 0;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (event: PointerEvent): void => {
    // Follow owns the centre while it is on, so a drag would be a tug of war
    // that the frame loop wins every frame.
    if (event.button !== 0 || settings.follow || !active()) return;
    dragging = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    target.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (dragging !== event.pointerId) return;
    const perPixel = camera.worldPerPixel;
    // Drag the world, not the camera, so the ground follows the pointer. The y
    // flip is the screen's, not the world's.
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
      // A no-op when nothing has changed it: the camera's setter compares
      // before it marks the transform dirty.
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
