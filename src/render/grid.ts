import type { Camera } from '../camera/camera';
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
] as const;

/**
 * A rectangle of the drawing buffer, in device pixels, **y measured from the
 * bottom** as GL viewports are. The whole buffer for a normal frame; one
 * quadrant at a time in comparison mode.
 */
export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridRenderer {
  /**
   * Draws the grid over `rect`, which is left as the current GL viewport.
   * Opaque, and covers every pixel of the rect, so it needs no clear under it.
   */
  draw(camera: Camera, pixelRatio: number, style: Readonly<GridStyle>, rect: ViewportRect): void;
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

    draw(camera, pixelRatio, style, rect): void {
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

      draw(gl, vao, gl.TRIANGLES, 3);
    },

    dispose(): void {
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
    },
  };
}
