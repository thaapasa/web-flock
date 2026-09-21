import type { Bounds, Vec2 } from '../math/types';

/**
 * World space has +y up and screen space has +y down. The flip happens here and
 * nowhere else.
 *
 * The camera holds zoom as `logScale`, the base-10 logarithm of CSS pixels per
 * world unit. The viewport is in CSS pixels too, matching pointer coordinates.
 */

export interface CameraOptions {
  /** World point at the centre of the viewport. Defaults to the origin. */
  center?: Vec2;
  /** Defaults to 0, one CSS pixel per world unit. */
  logScale?: number;
  /** CSS pixels. */
  viewportWidth?: number;
  viewportHeight?: number;
}

export class Camera {
  /** World point at the centre. Move it with setCenter, or the transform goes stale. */
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

  /** World units per CSS pixel. */
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

  /** +1 makes the world ten times larger on screen. */
  zoomByDecades(decades: number): void {
    this.logScale = this._logScale + decades;
  }

  /** Screen coordinates are CSS pixels from the top-left, +y down. */
  worldToScreen(worldX: number, worldY: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    out.x = (worldX - this.center.x) * this._scale + this._viewportWidth / 2;
    out.y = this._viewportHeight / 2 - (worldY - this.center.y) * this._scale;
    return out;
  }

  /** Screen coordinates are CSS pixels from the top-left, +y down. */
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
   * World space to clip space, as a column-major `mat3` for `uniformMatrix3fv`.
   * Clip space has +y up, so nothing flips here.
   *
   * The camera owns the array and rewrites it in place, so it is valid only
   * until the camera next changes.
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
