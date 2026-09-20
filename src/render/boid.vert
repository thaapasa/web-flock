#version 300 es

/**
 * One instanced quad per boid, oriented along its velocity. The chevron itself
 * is found per pixel in the fragment shader, so this only has to deliver a
 * rectangle big enough to hold it, and the local coordinates to measure
 * against.
 *
 * Everything local is in **device pixels**, with +x along the heading, which
 * is what lets the whole mark be specified in pixels and stay the same weight
 * at any zoom.
 */

layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aVelocity;
layout(location = 2) in float aDensity;

/** World to clip for this viewport rect. Not the camera's own matrix: in
    comparison mode each quadrant is a smaller viewport at the same scale. */
uniform mat3 uTransform;
/** Clip units per device pixel, x and y. */
uniform vec2 uPixelToClip;

uniform float uLength;
uniform float uHalfWidth;
/** Slack around the mark so a stroke has room to fade out at the quad's edge. */
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

  // The boid's position goes through the matrix; its shape is added afterwards
  // in pixels. Doing the shape in world units and scaling it would make the
  // stroke width a function of zoom, which is exactly what it must not be.
  vec3 clip = uTransform * vec3(aPosition, 1.0);
  gl_Position = vec4(clip.xy + offset * uPixelToClip, 0.0, 1.0);
}
