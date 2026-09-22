import type { Camera } from '../camera/camera';
import type { CanvasSize } from './canvas';
import { createProgram, createVertexArray, draw, getUniformLocations, withDefines } from './gl';
import fragmentSource from './grid.frag?raw';
import vertexSource from './grid.vert?raw';
import type { GridBand } from './grid-bands';
import { axisWeight, bandPhase, computeBands, createBands, MAX_BANDS } from './grid-bands';
import type { GridStyle } from './grid-style';
import { ORIGIN_MARKER_CODES } from './grid-style';

/**
 * The adaptive axis grid. `grid-bands.ts` picks the decades and their weights;
 * what is left here is geometry and antialiasing.
 *
 * Everything the shader sees is in device pixels, never world units. Once the
 * flock has migrated a few hundred thousand units out, float32 runs out of
 * mantissa and the lines shimmer. A pixel offset from the camera centre stays
 * small whatever the camera is looking at, and `bandPhase` does the reduction
 * that keeps it small, once per decade per frame in float64.
 */

const UNIFORM_NAMES = [
  'uCentre',
  'uBands',
  'uSpacing[0]',
  'uPhase[0]',
  'uWeightLinear[0]',
  'uSnapLines',
  'uLineWidth',
  'uLineColour',
  'uBrightness',
  'uOriginOffset',
  'uAxisWeight',
  'uOriginMarker',
  'uOriginRadius',
  'uOriginBoost',
  'uCursorOffset',
  'uCursorRadius',
  'uCursorBoost',
] as const;

/**
 * Where the cursor force reaches.
 *
 * The grid draws the ring because it can already put a circle of an exact
 * world radius on screen crisply at any zoom, for one branch in a shader that
 * runs anyway. A separate pass would need blending, which `boids.ts` leaves
 * off.
 */
export interface CursorRing {
  /** World position of the pointer. */
  readonly x: number;
  readonly y: number;
  /** World units. */
  readonly radius: number;
}

export interface GridRenderer {
  /** Opaque over the whole drawing buffer, so it needs no clear under it. */
  draw(
    camera: Camera,
    size: CanvasSize,
    style: Readonly<GridStyle>,
    cursor: CursorRing | null,
  ): void;
  /** The decades drawn by the last call, finest first. */
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

    draw(camera, size, style, cursor): void {
      const { pixelRatio } = size;
      // Band selection works in CSS pixels, the unit the style is written in.
      // Only the upload converts to device pixels.
      liveBands = computeBands(camera.scale, style, bands);
      const devicePixelsPerUnit = camera.scale * pixelRatio;

      for (let i = 0; i < liveBands; i++) {
        const band = bands[i];
        spacing[i] = band.spacing * pixelRatio;
        phase[i * 2] = bandPhase(camera.center.x, band.exponent, devicePixelsPerUnit);
        phase[i * 2 + 1] = bandPhase(camera.center.y, band.exponent, devicePixelsPerUnit);
        // In light rather than in sRGB, because the shader multiplies it by a
        // coverage and then converts the two together.
        weight[i] = band.weight ** 2.2;
      }

      gl.useProgram(program);

      gl.uniform2f(uniforms.uCentre, size.deviceWidth / 2, size.deviceHeight / 2);
      gl.uniform1i(uniforms.uBands, liveBands);
      gl.uniform1fv(uniforms['uSpacing[0]'], spacing);
      gl.uniform2fv(uniforms['uPhase[0]'], phase);
      gl.uniform1fv(uniforms['uWeightLinear[0]'], weight);

      gl.uniform1i(uniforms.uSnapLines, style.snapLines ? 1 : 0);
      gl.uniform1f(uniforms.uLineWidth, style.lineWidth * pixelRatio);
      gl.uniform3fv(uniforms.uLineColour, style.lineColor);
      gl.uniform1f(uniforms.uBrightness, style.brightness);

      // The origin is only ever a screenful or so away in the cases that
      // matter. When it is millions of pixels off it is off screen, so a
      // float32 that has lost its low bits by then costs nothing.
      gl.uniform2f(
        uniforms.uOriginOffset,
        -camera.center.x * devicePixelsPerUnit,
        -camera.center.y * devicePixelsPerUnit,
      );
      // Bands are in CSS pixels here, so the viewport has to be too.
      const room = Math.min(camera.viewportWidth, camera.viewportHeight);
      const axis = axisWeight(bands, liveBands, room, style.fadeCurve);
      gl.uniform1f(uniforms.uAxisWeight, axis * style.axisBoost);

      gl.uniform1i(uniforms.uOriginMarker, ORIGIN_MARKER_CODES[style.origin]);
      gl.uniform1f(uniforms.uOriginRadius, style.originRadius * pixelRatio);
      gl.uniform1f(uniforms.uOriginBoost, style.originBoost);

      // The radius is a distance in the flock's world, so the ring grows and
      // shrinks with the zoom. The offset stays small whatever the camera is
      // looking at, because the pointer is on screen.
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
