import type { Camera } from '../camera/camera';
import { createProgram, createVertexArray, draw, getUniformLocations } from './gl';
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

const VERTEX_SOURCE = `#version 300 es
// A single oversized triangle rather than a quad: no vertex buffer, no shared
// edge down the middle of the screen, and the GPU clips it to the viewport.
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;

#define MAX_BANDS ${MAX_BANDS}

/** Device-pixel position of the camera centre within the drawing buffer. */
uniform vec2 uCentre;

uniform int uBands;
/** Device pixels between this decade's lines. */
uniform float uSpacing[MAX_BANDS];
/** Device pixels from the camera centre to this decade's nearest line. */
uniform vec2 uPhase[MAX_BANDS];
uniform float uWeight[MAX_BANDS];

uniform float uLineWidth;
uniform vec3 uLineColour;
uniform float uBrightness;

/** Device pixels from the camera centre to the world origin. */
uniform vec2 uOriginOffset;
/** Multipliers on uBrightness, not brightnesses. See grid-style.ts. */
uniform float uAxisBoost;

uniform int uOriginMarker;
uniform float uOriginRadius;
uniform float uOriginBoost;

out vec4 fragColour;

/**
 * How much of a pixel a line of total width w, whose centre is d pixels away,
 * covers. A box filter rather than a smoothstep, because it stays honest below
 * one pixel: a half-pixel line comes out at half brightness instead of being
 * quietly fattened to a full one, which is what keeps fine lines fading out
 * rather than crowding together.
 */
float lineCoverage(float d, float w) {
  return clamp(w * 0.5 + 0.5 - d, 0.0, min(w, 1.0));
}

float markerCoverage(vec2 d, float radius, float width, int marker) {
  if (marker == 1) return lineCoverage(abs(length(d) - radius), width);
  if (marker == 2) return clamp(radius + 0.5 - length(d), 0.0, 1.0);
  if (marker == 3) {
    float across = lineCoverage(d.y, width) * clamp(radius + 0.5 - d.x, 0.0, 1.0);
    float up = lineCoverage(d.x, width) * clamp(radius + 0.5 - d.y, 0.0, 1.0);
    return max(across, up);
  }
  return 0.0;
}

void main() {
  vec2 rel = gl_FragCoord.xy - uCentre;

  // max, never sum. Every line belongs to its own decade and to all the finer
  // ones below it, so adding the decades up would make every coarse line and
  // every intersection brighter than it should be, and the whole picture pulse
  // as decades come and go. Taking the maximum draws each line at the weight
  // of the coarsest decade it belongs to, which is the rule the grid is built
  // on -- see grid-bands.ts.
  float intensity = 0.0;
  for (int i = 0; i < MAX_BANDS; i++) {
    if (i >= uBands) break;
    float spacing = uSpacing[i];
    vec2 u = rel + uPhase[i];
    vec2 d = abs(u - spacing * round(u / spacing));
    float coverage = max(lineCoverage(d.x, uLineWidth), lineCoverage(d.y, uLineWidth));
    intensity = max(intensity, coverage * uWeight[i]);
  }

  vec3 colour = uLineColour * (intensity * uBrightness);

  // The axes are the same line as every other, at the same colour and width,
  // carrying a little more brightness -- the coarsest decade on screen plus a
  // nudge. They replace what is under them rather than adding to it, so a
  // crossing does not blow out.
  vec2 fromOrigin = abs(rel - uOriginOffset);
  float axis = max(lineCoverage(fromOrigin.x, uLineWidth), lineCoverage(fromOrigin.y, uLineWidth));
  colour = mix(colour, uLineColour * min(1.0, uBrightness * uAxisBoost), axis);

  float marker = markerCoverage(fromOrigin, uOriginRadius, uLineWidth, uOriginMarker);
  colour = mix(colour, uLineColour * min(1.0, uBrightness * uOriginBoost), marker);

  fragColour = vec4(colour, 1.0);
}
`;

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
  const program = createProgram(gl, VERTEX_SOURCE, FRAGMENT_SOURCE, 'grid');
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
