import type { Camera } from '../camera/camera';
import type { ViewportRect } from './gl';
import { createProgram, createVertexArray, draw, getUniformLocations, withDefines } from './gl';
import fragmentSource from './grid.frag?raw';
import vertexSource from './grid.vert?raw';
import type { GridBand } from './grid-bands';
import { bandPhase, computeBands, createBands, MAX_BANDS } from './grid-bands';
import type { GridStyle } from './grid-style';
import { ORIGIN_MARKER_CODES } from './grid-style';

/**
 * The adaptive axis grid.
 *
 * One fullscreen triangle, one draw call, no geometry: every line is found
 * per-pixel from the distance to the nearest multiple of each visible decade.
 * That is what makes it unbounded — there is no vertex buffer to run out of,
 * and a line ten million units from the origin costs exactly what one at the
 * origin costs.
 *
 * Which decades are visible and how bright each one is comes out of
 * `grid-bands.ts`, on the CPU, where it is testable. What is left here is
 * geometry and antialiasing.
 *
 * **Everything in the shader is in device pixels.** Not world units: a world
 * unit is a bad numeric neighbourhood to work in once the flock has migrated a
 * few hundred thousand units out, because float32 runs out of mantissa and the
 * lines start to shimmer. Pixel offsets relative to the camera centre are
 * always small, whatever the camera is looking at, so the shader never handles
 * a large number at all. The reduction that makes that true is `bandPhase`,
 * done once per decade per frame in float64.
 */

const UNIFORM_NAMES = [
  'uCentre',
  'uBands',
  'uSpacing[0]',
  'uPhase[0]',
  'uWeight[0]',
  'uLineWidth',
  'uLineColour',
  'uBrightness',
  'uOriginOffset',
  'uAxisBoost',
  'uOriginMarker',
  'uOriginRadius',
  'uOriginBoost',
  'uCursorOffset',
  'uCursorRadius',
  'uCursorBoost',
] as const;

/**
 * Where the cursor force reaches, in world units, or null for no ring.
 *
 * The grid draws it because PLAN.md asks for the radius to be drawn on the
 * grid, and because the grid is already the thing that can draw a circle of an
 * exact world radius crisply at any zoom. It costs one branch in a shader that
 * was running anyway -- a separate pass would need blending turned back on,
 * which `boids.ts` deliberately leaves off.
 */
export interface CursorRing {
  /** World position of the pointer. */
  readonly x: number;
  readonly y: number;
  /** World units. */
  readonly radius: number;
}

export interface GridRenderer {
  /**
   * Draws the grid over `rect`, which is left as the current GL viewport.
   * Opaque, and covers every pixel of the rect, so it needs no clear under it.
   */
  draw(
    camera: Camera,
    pixelRatio: number,
    style: Readonly<GridStyle>,
    rect: ViewportRect,
    cursor: CursorRing | null,
  ): void;
  /** The decades drawn by the last call, finest first. Valid for labelling. */
  readonly bands: readonly GridBand[];
  readonly bandCount: number;
  dispose(): void;
}

export function createGridRenderer(gl: WebGL2RenderingContext): GridRenderer {
  const program = createProgram(
    gl,
    vertexSource,
    withDefines(fragmentSource, { MAX_BANDS }),
    'grid',
  );
  const uniforms = getUniformLocations(gl, program, UNIFORM_NAMES);
  // No attributes: the triangle comes from gl_VertexID. WebGL2 still wants a
  // vertex array object bound for the draw.
  const vao = createVertexArray(gl, []);

  const bands = createBands();
  let liveBands = 0;

  const spacing = new Float32Array(MAX_BANDS);
  const phase = new Float32Array(MAX_BANDS * 2);
  const weight = new Float32Array(MAX_BANDS);

  return {
    bands,
    get bandCount() {
      return liveBands;
    },

    draw(camera, pixelRatio, style, rect, cursor): void {
      // Band selection works in CSS pixels, because that is the unit the style
      // is written in and what makes the grid look equally dense on a 1x
      // display and a Retina one. Only the upload converts to device pixels.
      liveBands = computeBands(camera.scale, style, bands);
      const devicePixelsPerUnit = camera.scale * pixelRatio;

      for (let i = 0; i < liveBands; i++) {
        const band = bands[i];
        spacing[i] = band.spacing * pixelRatio;
        phase[i * 2] = bandPhase(camera.center.x, band.exponent, devicePixelsPerUnit);
        phase[i * 2 + 1] = bandPhase(camera.center.y, band.exponent, devicePixelsPerUnit);
        weight[i] = band.weight;
      }

      gl.viewport(rect.x, rect.y, rect.width, rect.height);
      gl.useProgram(program);

      gl.uniform2f(uniforms.uCentre, rect.x + rect.width / 2, rect.y + rect.height / 2);
      gl.uniform1i(uniforms.uBands, liveBands);
      gl.uniform1fv(uniforms['uSpacing[0]'], spacing);
      gl.uniform2fv(uniforms['uPhase[0]'], phase);
      gl.uniform1fv(uniforms['uWeight[0]'], weight);

      gl.uniform1f(uniforms.uLineWidth, style.lineWidth * pixelRatio);
      gl.uniform3fv(uniforms.uLineColour, style.lineColor);
      gl.uniform1f(uniforms.uBrightness, style.brightness);

      // The origin is only ever a screenful or so away in the cases that
      // matter; when it is millions of pixels off it is off screen, and a
      // float32 that has lost its low bits by then costs nothing.
      gl.uniform2f(
        uniforms.uOriginOffset,
        -camera.center.x * devicePixelsPerUnit,
        -camera.center.y * devicePixelsPerUnit,
      );
      gl.uniform1f(uniforms.uAxisBoost, style.axisBoost);

      gl.uniform1i(uniforms.uOriginMarker, ORIGIN_MARKER_CODES[style.origin]);
      gl.uniform1f(uniforms.uOriginRadius, style.originRadius * pixelRatio);
      gl.uniform1f(uniforms.uOriginBoost, style.originBoost);

      // World units, so the ring grows and shrinks with the zoom rather than
      // staying a fixed circle on screen: it is a distance in the flock's
      // world, and it has to read as one. The offset is small whatever the
      // camera is looking at, because the pointer is on screen by definition.
      const radius = cursor ? cursor.radius * devicePixelsPerUnit : 0;
      gl.uniform2f(
        uniforms.uCursorOffset,
        cursor ? (cursor.x - camera.center.x) * devicePixelsPerUnit : 0,
        cursor ? (cursor.y - camera.center.y) * devicePixelsPerUnit : 0,
      );
      gl.uniform1f(uniforms.uCursorRadius, radius);
      gl.uniform1f(uniforms.uCursorBoost, style.cursorBoost);

      draw(gl, vao, gl.TRIANGLES, 3);
    },

    dispose(): void {
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
    },
  };
}
