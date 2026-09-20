#version 300 es

/**
 * The history trail: a ribbon threaded through where the boid has just been.
 *
 * One triangle strip per boid, two vertices per recorded sample, expanded
 * sideways in device pixels so the ribbon's width does not change with zoom.
 * The samples come out of the history texture — see `trail-history.ts` for why
 * a texture rather than attributes, and what is in each texel.
 *
 * Sample 0 is the boid's **live** state rather than a recorded one, so the
 * ribbon stays welded to the mark instead of lagging it by up to a capture
 * interval, and its colour there matches the chevron's exactly.
 *
 * Every sample is then slid back along the path by `uInset`, half a mark
 * length, so the ribbon emerges from the middle of the chevron's open back
 * rather than from the boid's centre — which is inside the V, where the trail
 * crossed its own arms. Sliding the whole ribbon rather than only its head
 * keeps it monotone: a boid covers less than half a mark between captures, so
 * insetting the head alone would push it behind the sample after it and fold
 * the first segment over.
 */

layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aVelocity;
layout(location = 2) in float aDensity;

uniform mat3 uTransform;
uniform vec2 uPixelToClip;

uniform highp sampler2D uHistory;
/** Rows in the texture, and the row holding the newest capture. */
uniform int uRows;
uniform int uNewest;
/** Samples drawn, live state included. */
uniform int uSamples;

/** Device pixels, half the ribbon's width where it leaves the boid. */
uniform float uHalfWidth;
/** Device pixels the whole ribbon is slid back along the path. */
uniform float uInset;
/** Exponent on the width taper. Below 1 the ribbon keeps its body longer. */
uniform float uTaper;
uniform float uFalloff;
uniform float uBrightness;

uniform int uColourMode;
/** 0 takes the boid's colour for the whole trail, 1 colours each sample. */
uniform int uTrailColour;
uniform vec2 uRange;
uniform vec3 uLowColour;
uniform vec3 uHighColour;

out float vAcross;
out float vHalf;
out float vAlpha;
out vec3 vColour;

/** `(x, y, speed, density)`, live for sample 0 and recorded beyond it. */
vec4 sampleAt(int k) {
  if (k <= 0) return vec4(aPosition, length(aVelocity), aDensity);
  // Walking backwards from the newest row. The bias keeps the operand of % away
  // from negative numbers, where GLSL ES leaves the result undefined.
  int row = (uNewest + 2 * uRows - (k - 1)) % uRows;
  return texelFetch(uHistory, ivec2(gl_InstanceID, row), 0);
}

void main() {
  int k = gl_VertexID >> 1;
  float side = (gl_VertexID & 1) == 0 ? -1.0 : 1.0;

  vec4 here = sampleAt(k);
  vec2 p = here.xy;
  vec2 ahead = sampleAt(max(k - 1, 0)).xy;
  vec2 behind = sampleAt(min(k + 1, uSamples - 1)).xy;

  // A central difference, so the ribbon's width stays square to the path
  // through a turn rather than pinching on the inside of it.
  vec2 along = ahead - behind;
  float span = length(along);
  if (span > 1e-9) {
    along /= span;
  } else {
    // A boid that has not moved between samples, or history that has just been
    // seeded and holds the same point in every row.
    float speed = length(aVelocity);
    along = speed > 1e-9 ? aVelocity / speed : vec2(1.0, 0.0);
  }
  vec2 perp = vec2(-along.y, along.x);

  // Never pow(0.0, x). The spec defines it, but drivers that compute pow as
  // exp2(y * log2(x)) hand back a NaN from log2(0) — and a NaN here is a vertex
  // output, so it interpolates across the whole last segment and lands in the
  // framebuffer as saturated white. The floor costs nothing visible: raised to
  // any useful exponent it is already far below one part in a million.
  float left = max(1.0 - float(k) / float(max(uSamples - 1, 1)), 1e-4);
  vHalf = uHalfWidth * pow(left, uTaper);
  vAlpha = pow(left, uFalloff) * uBrightness;
  // A pixel of slack either side, so a ribbon thinner than a pixel still has
  // somewhere to fade out rather than being clipped to nothing by the geometry.
  float reach = vHalf + 1.0;
  vAcross = side * reach;

  vec4 read = uTrailColour == 1 ? here : vec4(aPosition, length(aVelocity), aDensity);
  float value = uColourMode == 2 ? read.w : read.z;
  float ramp = uColourMode == 0
    ? 0.0
    : clamp((value - uRange.x) / max(uRange.y - uRange.x, 1e-6), 0.0, 1.0);
  vColour = mix(uLowColour, uHighColour, ramp);

  vec3 clip = uTransform * vec3(p, 1.0);
  vec2 offset = perp * vAcross - along * uInset;
  gl_Position = vec4(clip.xy + offset * uPixelToClip, 0.0, 1.0);
}
