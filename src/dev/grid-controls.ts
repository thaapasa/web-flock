import type { Camera } from '../camera/camera';
import type { GridStyle } from '../render/grid-style';
import { GRID_PRESETS } from '../render/grid-style';
import type { OverlayOptions } from '../render/overlay';
import type { PresetSelection, QuadrantView } from './compare';
import { createPresetSelection } from './compare';

/**
 * Scaffolding for step 3, and only for step 3.
 *
 * The grid cannot be judged without a zoom to scroll and somewhere to scroll
 * to, and neither exists yet: the wheel becomes a framing control in step 5
 * and the camera starts following the flock in step 6. So the wheel drives
 * `logScale` directly here, and dragging moves the camera — which the finished
 * app deliberately will not do (PLAN.md: no manual pan, no follow/override
 * state machine).
 *
 * Panning earns its place all the same: the grid has to stay crisp a long way
 * from the origin, where float32 would have given up, and there is no way to
 * check that from a camera pinned to the centre. Step 4a leans on it too, to
 * walk along the row of design specimens.
 *
 * The number keys are shared with `boid-controls.ts`, which owns the switch
 * between them; `active` is how this half knows the keyboard is pointed at it.
 * Zoom, pan and the label options stay live either way — they are not a choice
 * between two lists, so there is nothing for them to collide with.
 *
 * **This whole file is deleted in step 5.** Nothing outside `dev/` may import
 * from it.
 */

/** Decades of zoom per pixel of wheel travel. */
const WHEEL_SENSITIVITY = 0.0016;
/** Decades per keypress, for stepping through a handover frame by frame. */
const KEY_ZOOM_STEP = 0.05;
const MIN_LOG_SCALE = -3;
const MAX_LOG_SCALE = 3;

export interface GridControls {
  /** The style to draw an ordinary frame with. */
  readonly style: Readonly<GridStyle>;
  /** Four panes in comparison mode, reading order; null otherwise. */
  readonly quadrants: readonly QuadrantView<Readonly<GridStyle>>[] | null;
  readonly help: string;
  dispose(): void;
}

export function createGridControls(
  target: HTMLElement,
  camera: Camera,
  overlayOptions: OverlayOptions,
  /** Whether the number keys currently belong to the grid. */
  active: () => boolean = () => true,
): GridControls {
  const selection: PresetSelection<Readonly<GridStyle>> = createPresetSelection(GRID_PRESETS);

  const zoomBy = (decades: number): void => {
    camera.logScale = Math.min(MAX_LOG_SCALE, Math.max(MIN_LOG_SCALE, camera.logScale + decades));
  };

  const onWheel = (event: WheelEvent): void => {
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
    if (event.button !== 0) return;
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

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (active() && selection.handleKey(event.key)) {
      event.preventDefault();
      return;
    }

    switch (event.key) {
      case '0':
        camera.setCenter(0, 0);
        camera.logScale = 0;
        break;
      case 'l':
        overlayOptions.placement = overlayOptions.placement === 'edge' ? 'axis' : 'edge';
        break;
      case 'f':
        overlayOptions.format = overlayOptions.format === 'plain' ? 'compact' : 'plain';
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
    get style() {
      return selection.style;
    },

    get quadrants() {
      return active() ? selection.quadrants : null;
    },

    get help() {
      return `wheel zoom · drag pan · ${selection.help} · l labels · f format · 0 reset`;
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
