#version 300 es

/**
 * One instanced quad per boid, turned along its velocity. The fragment shader
 * finds the chevron per pixel, so this only delivers a rectangle big enough to
 * hold it and the local coordinates to measure against.
 *
 * Local coordinates are device pixels, +x along the heading.
 */

layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aVelocity;
layout(location = 2) in float aDensity;

/** World to clip for this viewport rect, built in boids.ts. In comparison mode
    the rect is one quadrant rather than the whole window. */
uniform mat3 uTransform;
/** Clip units per device pixel, x and y. */
uniform vec2 uPixelToClip;

uniform float uLength;
uniform float uHalfWidth;
/** Slack around the mark so a stroke can fade out inside the quad. */
uniform float uPad;

uniform int uColourMode;
uniform vec2 uRange;
uniform vec3 uLowColour;
uniform vec3 uHighColour;

out vec2 vLocal;
out vec3 vColour;

void main() {
  // (0,0) (1,0) (0,1) (1,1) as a triangle strip, mapped to [-1, 1].
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;

  vec2 local = vec2(corner.x * (uLength * 0.5 + uPad), corner.y * (uHalfWidth + uPad));
  vLocal = local;

  float speed = length(aVelocity);
  vec2 heading = speed > 1e-9 ? aVelocity / speed : vec2(1.0, 0.0);
  vec2 offset = vec2(
    local.x * heading.x - local.y * heading.y,
    local.x * heading.y + local.y * heading.x);

  float value = uColourMode == 2 ? aDensity : speed;
  float t = uColourMode == 0
    ? 0.0
    : clamp((value - uRange.x) / max(uRange.y - uRange.x, 1e-6), 0.0, 1.0);
  vColour = mix(uLowColour, uHighColour, t);

  // The position goes through the matrix, the shape is added after it in
  // pixels. Shaping in world units and scaling would tie stroke width to zoom.
  vec3 clip = uTransform * vec3(aPosition, 1.0);
  gl_Position = vec4(clip.xy + offset * uPixelToClip, 0.0, 1.0);
}
