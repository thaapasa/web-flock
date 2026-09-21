/** A point or vector in world space, where +y points up. */
export interface Vec2 {
  x: number;
  y: number;
}

/** An axis-aligned rectangle in world space. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
