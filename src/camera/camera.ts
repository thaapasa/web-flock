import type { Bounds, Vec2 } from '../math/types';

/**
 * The world/screen transform.
 *
 * Two conventions run through the whole project and are set here:
 *
 * 1. **World space has +y up.** Screen space has +y down, as the DOM does. The
 *    flip lives in this file and nowhere else, so nothing downstream of the
 *    camera has to think about it.
 *
 * 2. **Zoom is held as a base-10 logarithm**, `logScale = log10(pixels per
 *    world unit)`. Everything that cares about zoom wants it that way: the
 *    grid fades one decade at a time, so `Math.floor(logScale)` names the
 *    decade currently on screen and the fractional part is how far through the
 *    handover we are. Multiplicative zoom steps become plain addition, and
 *    damping toward a target zoom is linear in this space, which is what makes
 *    it feel even rather than accelerating.
 *
 * The viewport is measured in **CSS pixels**, matching pointer coordinates.
 * Device pixels only matter to `gl.viewport` and to line widths in shaders;
 * the clip-space transform is the same either way, because it depends on the
 * ratio of scale to viewport size rather than on either one alone.
 */

export interface CameraOptions {
  /** World point at the centre of the viewport. Defaults to the origin. */
  center?: Vec2;
  /** log10(CSS pixels per world unit). Defaults to 0, i.e. 1 pixel per unit. */
  logScale?: number;
  /** CSS pixels. */
  viewportWidth?: number;
  viewportHeight?: number;
}

export class Camera {
  /** World point at the centre of the viewport. Mutate via {@link setCenter}. */
  readonly center: Vec2 = { x: 0, y: 0 };

  private _logScale: number;
  private _scale: number;
  private _viewportWidth: number;
  private _viewportHeight: number;

  private readonly _worldToClip = new Float32Array(9);
  private _worldToClipDirty = true;

  constructor(options: CameraOptions = {}) {
    this.center.x = options.center?.x ?? 0;
    this.center.y = options.center?.y ?? 0;
    this._logScale = options.logScale ?? 0;
    this._scale = 10 ** this._logScale;
    this._viewportWidth = Math.max(1, options.viewportWidth ?? 1);
    this._viewportHeight = Math.max(1, options.viewportHeight ?? 1);
  }

  /** log10(CSS pixels per world unit). */
  get logScale(): number {
    return this._logScale;
  }

  set logScale(value: number) {
    if (value === this._logScale) return;
    this._logScale = value;
    this._scale = 10 ** value;
    this._worldToClipDirty = true;
  }

  /** CSS pixels per world unit. */
  get scale(): number {
    return this._scale;
  }

  /** World units per CSS pixel. The natural unit for "how big is a pixel". */
  get worldPerPixel(): number {
    return 1 / this._scale;
  }

  get viewportWidth(): number {
    return this._viewportWidth;
  }

  get viewportHeight(): number {
    return this._viewportHeight;
  }

  setCenter(x: number, y: number): void {
    if (x === this.center.x && y === this.center.y) return;
    this.center.x = x;
    this.center.y = y;
    this._worldToClipDirty = true;
  }

  /** Both in CSS pixels. */
  setViewport(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    if (w === this._viewportWidth && h === this._viewportHeight) return;
    this._viewportWidth = w;
    this._viewportHeight = h;
    this._worldToClipDirty = true;
  }

  /**
   * Zooms by a number of decades: +1 makes the world ten times larger on
   * screen. Additive here because zoom is logarithmic.
   */
  zoomByDecades(decades: number): void {
    this.logScale = this._logScale + decades;
  }

  /** Screen coordinates are CSS pixels from the top-left, **+y down**. */
  worldToScreen(worldX: number, worldY: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    out.x = (worldX - this.center.x) * this._scale + this._viewportWidth / 2;
    out.y = this._viewportHeight / 2 - (worldY - this.center.y) * this._scale;
    return out;
  }

  /** Screen coordinates are CSS pixels from the top-left, **+y down**. */
  screenToWorld(screenX: number, screenY: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    out.x = this.center.x + (screenX - this._viewportWidth / 2) / this._scale;
    out.y = this.center.y - (screenY - this._viewportHeight / 2) / this._scale;
    return out;
  }

  /** The world rectangle currently on screen. */
  visibleBounds(out: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }): Bounds {
    const halfWidth = this._viewportWidth / 2 / this._scale;
    const halfHeight = this._viewportHeight / 2 / this._scale;
    out.minX = this.center.x - halfWidth;
    out.maxX = this.center.x + halfWidth;
    out.minY = this.center.y - halfHeight;
    out.maxY = this.center.y + halfHeight;
    return out;
  }

  /**
   * World space to clip space, as a column-major `mat3` ready for a `uniformMatrix3fv`.
   *
   * Clip space already has +y up, so there is no flip here — the flip is only
   * in {@link worldToScreen} and {@link screenToWorld}, which speak the DOM's
   * y-down language.
   *
   * The returned array is owned by the camera and rewritten in place, so treat
   * it as valid only until the next camera change.
   */
  worldToClip(): Float32Array {
    if (this._worldToClipDirty) {
      const sx = (2 * this._scale) / this._viewportWidth;
      const sy = (2 * this._scale) / this._viewportHeight;
      const m = this._worldToClip;
      // Column-major: columns are (sx,0,0), (0,sy,0), (tx,ty,1).
      m[0] = sx;
      m[1] = 0;
      m[2] = 0;
      m[3] = 0;
      m[4] = sy;
      m[5] = 0;
      m[6] = -this.center.x * sx;
      m[7] = -this.center.y * sy;
      m[8] = 1;
      this._worldToClipDirty = false;
    }
    return this._worldToClip;
  }
}
