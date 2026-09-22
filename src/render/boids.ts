import type { Camera } from '../camera/camera';
import type { FlockRanges } from '../sim/simulation';
import fragmentSource from './boid.frag?raw';
import vertexSource from './boid.vert?raw';
import type { BoidFeed, VertexAttributeSource } from './boid-feed';
import type { BoidStyle } from './boid-style';
import {
  COLOUR_INPUT_CODES,
  colourBand,
  floorBrightness,
  markLength,
  strokeWidth,
  TRAIL_COLOUR_CODES,
  trailSamples,
} from './boid-style';
import type { CanvasSize } from './canvas';
import type { AttributeSpec } from './gl';
import { createProgram, createVertexArray, drawInstanced, getUniformLocations } from './gl';
import trailFragmentSource from './trail.frag?raw';
import trailVertexSource from './trail.vert?raw';
import type { TrailHistory } from './trail-history';

/**
 * The ribbon and the chevron over it both take their shape in device pixels
 * around a position the matrix places, so stroke weight and trail width do not
 * change with zoom.
 *
 * Positions go through the matrix as float32, so a flock a million units out
 * would quantise. The pull toward the origin keeps it within a few thousand,
 * well short of that. If that ever stops holding, subtract the camera centre
 * before upload.
 */

const UNIFORM_NAMES = [
  'uTransform',
  'uPixelToClip',
  'uLength',
  'uHalfWidth',
  'uPad',
  'uLineWidth',
  'uBrightness',
  'uColourMode',
  'uRange',
  'uLowColour',
  'uHighColour',
] as const;

const TRAIL_UNIFORM_NAMES = [
  'uTransform',
  'uPixelToClip',
  'uHistory',
  'uRows',
  'uNewest',
  'uSamples',
  'uHalfWidth',
  'uInset',
  'uTaper',
  'uFalloff',
  'uBrightness',
  'uColourMode',
  'uTrailColour',
  'uRange',
  'uLowColour',
  'uHighColour',
] as const;

/** Attribute locations, matching the `layout(location = N)` in both shaders. */
const POSITION_LOCATION = 0;
const VELOCITY_LOCATION = 1;
const DENSITY_LOCATION = 2;

/**
 * A feed and its history, bound into a vertex array once. One VAO serves both
 * programs because neither has a per-vertex attribute: the quad's corners and
 * the ribbon's samples come from `gl_VertexID`.
 */
export interface BoidTarget {
  readonly feed: BoidFeed;
  readonly trails: TrailHistory;
  /** The simulation's live bands; read every frame, never copied. */
  readonly ranges: FlockRanges;
  readonly vao: WebGLVertexArrayObject;
  dispose(): void;
}

export interface BoidRenderer {
  /** Call it once per simulation, not per frame. */
  bind(feed: BoidFeed, trails: TrailHistory, ranges: FlockRanges): BoidTarget;
  draw(target: BoidTarget, camera: Camera, size: CanvasSize, style: Readonly<BoidStyle>): void;
  dispose(): void;
}

export function createBoidRenderer(gl: WebGL2RenderingContext): BoidRenderer {
  const program = createProgram(gl, vertexSource, fragmentSource, 'boid');
  const uniforms = getUniformLocations(gl, program, UNIFORM_NAMES);

  const trailProgram = createProgram(gl, trailVertexSource, trailFragmentSource, 'trail');
  const trailUniforms = getUniformLocations(gl, trailProgram, TRAIL_UNIFORM_NAMES);

  /** World to clip. Rewritten per draw; never escapes this module. */
  const transform = new Float32Array(9);

  const buildTransform = (camera: Camera, size: CanvasSize): void => {
    const sx = (2 * camera.scale * size.pixelRatio) / Math.max(size.deviceWidth, 1);
    const sy = (2 * camera.scale * size.pixelRatio) / Math.max(size.deviceHeight, 1);
    // Column-major, as the camera's own matrix is.
    transform[0] = sx;
    transform[1] = 0;
    transform[2] = 0;
    transform[3] = 0;
    transform[4] = sy;
    transform[5] = 0;
    transform[6] = -camera.center.x * sx;
    transform[7] = -camera.center.y * sy;
    transform[8] = 1;
  };

  return {
    bind(feed, trails, ranges): BoidTarget {
      const source = (attribute: VertexAttributeSource, location: number): AttributeSpec => ({
        location,
        buffer: attribute.buffer,
        size: attribute.size,
        type: attribute.type,
        stride: attribute.stride,
        offset: attribute.offset,
        // Per boid, never per vertex: the mark's geometry comes from gl_VertexID.
        divisor: 1,
      });

      const vao = createVertexArray(gl, [
        source(feed.position, POSITION_LOCATION),
        source(feed.velocity, VELOCITY_LOCATION),
        source(feed.density, DENSITY_LOCATION),
      ]);

      return {
        feed,
        trails,
        ranges,
        vao,
        dispose(): void {
          gl.deleteVertexArray(vao);
        },
      };
    },

    draw(target, camera, size, style): void {
      const { pixelRatio } = size;
      const count = target.feed.count;
      if (count === 0) return;

      // Style lengths are in CSS pixels; everything below is device pixels.
      const lengthCss = markLength(style, camera.scale);
      const length = lengthCss * pixelRatio;
      const halfWidth = length * Math.tan(style.halfAngle);
      const lineWidth = strokeWidth(style, lengthCss) * pixelRatio;
      const trailWidth = lineWidth * style.trailWidth;
      const [low, high] = colourBand(style, target.ranges);
      const brightness = style.brightness * floorBrightness(style, camera.scale);
      const colourMode = COLOUR_INPUT_CODES[style.colourBy];

      buildTransform(camera, size);
      const pixelToClipX = 2 / Math.max(size.deviceWidth, 1);
      const pixelToClipY = 2 / Math.max(size.deviceHeight, 1);

      gl.enable(gl.BLEND);
      // Both shaders emit premultiplied colour, so the source factor is ONE
      // either way and only the destination tells the two modes apart.
      gl.blendFunc(gl.ONE, style.blend === 'additive' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);

      const samples = trailSamples(style, target.trails.rows);
      if (samples >= 2) {
        gl.useProgram(trailProgram);
        gl.uniformMatrix3fv(trailUniforms.uTransform, false, transform);
        gl.uniform2f(trailUniforms.uPixelToClip, pixelToClipX, pixelToClipY);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, target.trails.texture);
        gl.uniform1i(trailUniforms.uHistory, 0);
        gl.uniform1i(trailUniforms.uRows, target.trails.rows);
        gl.uniform1i(trailUniforms.uNewest, target.trails.newest);
        gl.uniform1i(trailUniforms.uSamples, samples);

        gl.uniform1f(trailUniforms.uHalfWidth, trailWidth * 0.5);
        // Out to the middle of the chevron's open back, so the ribbon leaves
        // the mark rather than starting inside it.
        gl.uniform1f(trailUniforms.uInset, length * 0.5);
        gl.uniform1f(trailUniforms.uTaper, style.trailTaper);
        gl.uniform1f(trailUniforms.uFalloff, style.trailFalloff);
        gl.uniform1f(trailUniforms.uBrightness, brightness * style.trailBrightness);

        gl.uniform1i(trailUniforms.uColourMode, colourMode);
        gl.uniform1i(trailUniforms.uTrailColour, TRAIL_COLOUR_CODES[style.trailColour]);
        gl.uniform2f(trailUniforms.uRange, low, high);
        gl.uniform3fv(trailUniforms.uLowColour, style.lowColor);
        gl.uniform3fv(trailUniforms.uHighColour, style.highColor);

        // Two vertices per sample, one strip per boid.
        drawInstanced(gl, target.vao, gl.TRIANGLE_STRIP, samples * 2, count);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }

      gl.useProgram(program);
      gl.uniformMatrix3fv(uniforms.uTransform, false, transform);
      gl.uniform2f(uniforms.uPixelToClip, pixelToClipX, pixelToClipY);

      gl.uniform1f(uniforms.uLength, length);
      gl.uniform1f(uniforms.uHalfWidth, halfWidth);
      // Half the stroke, plus a pixel for the filter's ramp.
      gl.uniform1f(uniforms.uPad, lineWidth * 0.5 + 1);
      gl.uniform1f(uniforms.uLineWidth, lineWidth);

      gl.uniform1f(uniforms.uBrightness, brightness);

      gl.uniform1i(uniforms.uColourMode, colourMode);
      gl.uniform2f(uniforms.uRange, low, high);
      gl.uniform3fv(uniforms.uLowColour, style.lowColor);
      gl.uniform3fv(uniforms.uHighColour, style.highColor);

      drawInstanced(gl, target.vao, gl.TRIANGLE_STRIP, 4, count);

      // The grid draws opaque and owns its pixels. Leaving blending on would
      // make the next frame's clear-and-draw depend on this one.
      gl.disable(gl.BLEND);
    },

    dispose(): void {
      gl.deleteProgram(program);
      gl.deleteProgram(trailProgram);
    },
  };
}
