/**
 * The one colour type, shared by every style record.
 *
 * It lives on its own rather than in one of the style files because the grid
 * and the boids both need it and neither should have to import the other's
 * style to say what a colour is.
 */

/** Linear, 0..1 per channel. Not gamma-corrected; these are shader values. */
export type RGB = readonly [r: number, g: number, b: number];
