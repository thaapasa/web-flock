#version 300 es
precision highp float;

/**
 * The chevron, as a distance field.
 *
 * Two strokes from the nose to the two tail tips, measured per pixel and
 * covered with the same box filter the grid uses — which is what keeps a boid
 * crisp when it is large and lets it fade honestly rather than fattening when
 * it is smaller than a pixel. Stroke weight, and later a glow, are then a
 * number rather than a mesh.
 *
 * The trail is not here. It was, while step 4a was still deciding between a
 * streak along the velocity and a ribbon through the boid's recent positions;
 * the ribbon won, and it has its own shader because it needs geometry this one
 * cannot give it.
 */

in vec2 vLocal;
in vec3 vColour;

uniform float uLength;
uniform float uHalfWidth;
uniform float uLineWidth;
uniform float uBrightness;

out vec4 fragColour;

/** See grid.frag: a box filter, so a sub-pixel stroke dims instead of fattening. */
float lineCoverage(float d, float w) {
  return clamp(w * 0.5 + 0.5 - d, 0.0, min(w, 1.0));
}

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  vec2 ap = p - a;
  float t = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(ap - ab * t);
}

void main() {
  vec2 nose = vec2(uLength * 0.5, 0.0);
  vec2 tail = vec2(uLength * -0.5, 0.0);

  float d = min(
    segmentDistance(vLocal, nose, tail + vec2(0.0, uHalfWidth)),
    segmentDistance(vLocal, nose, tail - vec2(0.0, uHalfWidth)));

  // Premultiplied, so one fragment shader serves both blend modes.
  float alpha = lineCoverage(d, uLineWidth) * uBrightness;
  fragColour = vec4(vColour * alpha, alpha);
}
