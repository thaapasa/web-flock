import type { Camera } from '../camera/camera';
import type { GridStyle } from '../render/grid-style';
import { GRID_PRESETS } from '../render/grid-style';
import type { OverlayOptions } from '../render/overlay';

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
 * check that from a camera pinned to the centre.
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

const QUADRANTS = 4;

/** One pane of comparison mode. */
export interface QuadrantView {
  readonly style: Readonly<GridStyle>;
  /**
   * What the overlay prints in the corner. It leads with the preset's own
   * number, which is also the key that selects it — the quadrant's position on
   * screen is never a number, because two numberings for four panes is one too
   * many.
   */
  readonly caption: string;
}

export interface GridControls {
  /** The style to draw an ordinary frame with. */
  readonly style: Readonly<GridStyle>;
  /** Four panes in comparison mode, reading order; null otherwise. */
  readonly quadrants: readonly QuadrantView[] | null;
  readonly help: string;
  dispose(): void;
}

export function createGridControls(
  target: HTMLElement,
  camera: Camera,
  overlayOptions: OverlayOptions,
): GridControls {
  let preset = 0;
  let comparing = false;
  /** Index of the first of the four presets on screen in comparison mode. */
  let compareFrom = 0;

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

    if (event.key >= '1' && event.key <= '9') {
      const index = Number(event.key) - 1;
      if (index >= GRID_PRESETS.length) return;
      // A digit means the same thing in both modes: that preset, full screen.
      // In comparison mode the captions carry these same numbers, so a look
      // turns into a choice without leaving the mode first.
      preset = index;
      comparing = false;
      return;
    }

    switch (event.key) {
      case '0':
        camera.setCenter(0, 0);
        camera.logScale = 0;
        break;
      case 'c':
        comparing = !comparing;
        if (comparing) compareFrom = preset;
        break;
      // One preset at a time, not four: the window slides through the list so
      // any four neighbours can be seen together, rather than dealing the nine
      // into fixed pages that can never be compared across.
      case '[':
        compareFrom = (compareFrom - 1 + GRID_PRESETS.length) % GRID_PRESETS.length;
        break;
      case ']':
        compareFrom = (compareFrom + 1) % GRID_PRESETS.length;
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
      return GRID_PRESETS[preset];
    },

    get quadrants() {
      if (!comparing) return null;
      return Array.from({ length: QUADRANTS }, (_, i) => {
        const index = (compareFrom + i) % GRID_PRESETS.length;
        const style = GRID_PRESETS[index];
        return { style, caption: `${index + 1}  ${style.name}` };
      });
    },

    get help() {
      return comparing
        ? `wheel zoom · drag pan · [ ] slide through all ${GRID_PRESETS.length} · number picks · c exit compare`
        : `wheel zoom · drag pan · 1-${GRID_PRESETS.length} presets · c compare · l labels · f format · 0 reset`;
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
