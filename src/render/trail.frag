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

out vec4 fragColour;

void main() {
  float width = 2.0 * vHalf;
  float coverage = clamp(vHalf + 0.5 - abs(vAcross), 0.0, min(width, 1.0));
  float alpha = coverage * vAlpha;
  fragColour = vec4(vColour * alpha, alpha);
}
