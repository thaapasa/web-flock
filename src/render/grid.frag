#version 300 es
precision highp float;

// MAX_BANDS is injected by grid.ts from the constant in grid-bands.ts, so the
// two cannot drift. It is not defined here.

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

/**
 * The cursor force's reach, as device pixels from the camera centre and a
 * device-pixel radius.
 *
 * PLAN.md asks for the radius to be drawn "on the grid", and this is that
 * literally: the same colour, the same width, the same box filter as every
 * other line, replacing what is under it rather than adding to it. The ring is
 * the exact boundary of the force -- the falloff in flock.ts reaches zero at
 * the rim and nothing leaks past it -- so the circle says precisely what it
 * claims to.
 *
 * A radius of 0 draws nothing, which is how the `nothing` cursor mode and a
 * pointer that has left the canvas both turn it off.
 */
uniform vec2 uCursorOffset;
uniform float uCursorRadius;
uniform float uCursorBoost;

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

float ringCoverage(vec2 d, float radius, float width) {
  return lineCoverage(abs(length(d) - radius), width);
}

float markerCoverage(vec2 d, float radius, float width, int marker) {
  if (marker == 1) return ringCoverage(d, radius, width);
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

  // Last, so the ring stays readable wherever it crosses a line or an axis.
  if (uCursorRadius > 0.0) {
    float ring = ringCoverage(rel - uCursorOffset, uCursorRadius, uLineWidth);
    colour = mix(colour, uLineColour * min(1.0, uBrightness * uCursorBoost), ring);
  }

  fragColour = vec4(colour, 1.0);
}
