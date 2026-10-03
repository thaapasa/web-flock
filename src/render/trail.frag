#version 300 es
precision highp float;

/**
 * The ribbon's edges, antialiased as every other line here is. The geometry is a
 * pixel wider than the ribbon on each side and coverage comes from the distance
 * across it, so a ribbon tapered below a pixel dims instead of flickering.
 */

in float vAcross;
in float vHalf;
in float vAlpha;
in vec3 vColour;

uniform float uGlow;
uniform float uGlowRadius;

out vec4 fragColour;

void main() {
  float width = 2.0 * vHalf;
  float coverage = clamp(vHalf + 0.5 - abs(vAcross), 0.0, min(width, 1.0));
  // As in boid.frag: without a glow, no fragment computes the halo.
  if (uGlow > 0.0) {
    float outside = max(abs(vAcross) - vHalf, 0.0);
    coverage = min(coverage + uGlow * exp(-outside / max(uGlowRadius, 1e-3)), 1.0);
  }
  float alpha = coverage * vAlpha;
  fragColour = vec4(vColour * alpha, alpha);
}
