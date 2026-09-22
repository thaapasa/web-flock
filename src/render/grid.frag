#version 300 es
precision highp float;

// grid.ts injects MAX_BANDS from grid-bands.ts. It is not defined here.

/** Device-pixel position of the camera centre within the drawing buffer. */
uniform vec2 uCentre;

uniform int uBands;
/** Device pixels between this decade's lines. */
uniform float uSpacing[MAX_BANDS];
/** Device pixels from the camera centre to this decade's nearest line. */
uniform vec2 uPhase[MAX_BANDS];
/**
 * Each decade's weight, raised to 2.2 so it is a weight in light. grid.ts does
 * that, which keeps this shader to one `shade` per pixel rather than one per
 * band.
 */
uniform float uWeightLinear[MAX_BANDS];

/**
 * Whether each line is moved to the nearest pixel centre before it is drawn.
 *
 * A snapped line covers the same pixels wherever the view is, so it holds one
 * brightness while you pan. It pays for that by moving a whole pixel at a
 * time, and by spacing that alternates between two pixel counts where the true
 * spacing falls between them.
 */
uniform bool uSnapLines;

uniform float uLineWidth;
uniform vec3 uLineColour;
uniform float uBrightness;

/** Device pixels from the camera centre to the world origin. */
uniform vec2 uOriginOffset;
/**
 * The axes' weight: the weight of the brightest decade with lines on screen,
 * times the style's boost. grid.ts works it out, because which decades have
 * lines on screen is a question about the viewport.
 */
uniform float uAxisWeight;

uniform int uOriginMarker;
uniform float uOriginRadius;
uniform float uOriginBoost;

/**
 * The cursor force's reach: device pixels from the camera centre, and a
 * device-pixel radius. The ring is the exact boundary of the force, because
 * the falloff in flock.ts reaches zero at the rim.
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
 * fattened to a full one, so fine lines fade out rather than crowd together.
 */
float lineCoverage(float d, float w) {
  return clamp(w * 0.5 + 0.5 - d, 0.0, min(w, 1.0));
}

/**
 * Coverage as a multiplier on a colour the display reads as sRGB.
 *
 * Multiplying an sRGB value by half does not halve the light, it quarters it.
 * The same line lands as one covered pixel or as two half-covered ones
 * depending on where the pixel grid falls under it, so a plain multiply makes
 * it emit less than half the light in the second case, and panning slides
 * every line between the two. Raising the coverage to 1/2.2 puts light back in
 * proportion to coverage, which is what the box filter assumed all along.
 */
float shade(float coverage) {
  return pow(coverage, 1.0 / 2.2);
}

/** A screen coordinate, moved onto a pixel centre when snapping is on. */
float snapCoord(float position) {
  return uSnapLines ? floor(position) + 0.5 : position;
}

/**
 * Distance from this fragment to the nearest line of a decade, in pixels.
 * `u` is the fragment's position within that decade's lattice.
 */
float lineDistance(float frag, float u, float spacing) {
  float line = frag - u + spacing * round(u / spacing);
  return abs(frag - snapCoord(line));
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

  // max, never sum. A line belongs to its own decade and to every finer one,
  // so a sum would draw coarse lines and crossings brighter than they should
  // be. The maximum draws each line at the weight of the coarsest decade it
  // belongs to. See grid-bands.ts.
  float intensity = 0.0;
  for (int i = 0; i < MAX_BANDS; i++) {
    if (i >= uBands) break;
    float spacing = uSpacing[i];
    vec2 u = rel + uPhase[i];
    vec2 d = vec2(
      lineDistance(gl_FragCoord.x, u.x, spacing),
      lineDistance(gl_FragCoord.y, u.y, spacing)
    );
    float coverage = max(lineCoverage(d.x, uLineWidth), lineCoverage(d.y, uLineWidth));
    intensity = max(intensity, coverage * uWeightLinear[i]);
  }

  vec3 colour = uLineColour * (shade(intensity) * uBrightness);

  // The axes are ordinary lines carrying a little more brightness. They
  // replace what is under them rather than adding to it, so a crossing does
  // not blow out.
  vec2 origin = uCentre + uOriginOffset;
  vec2 fromOrigin = abs(gl_FragCoord.xy - vec2(snapCoord(origin.x), snapCoord(origin.y)));
  float axis = max(lineCoverage(fromOrigin.x, uLineWidth), lineCoverage(fromOrigin.y, uLineWidth));
  colour = mix(colour, uLineColour * min(1.0, uBrightness * uAxisWeight), shade(axis));

  float marker = markerCoverage(fromOrigin, uOriginRadius, uLineWidth, uOriginMarker);
  colour = mix(colour, uLineColour * min(1.0, uBrightness * uOriginBoost), shade(marker));

  // Last, so the ring stays readable wherever it crosses a line or an axis.
  if (uCursorRadius > 0.0) {
    float ring = ringCoverage(rel - uCursorOffset, uCursorRadius, uLineWidth);
    colour = mix(colour, uLineColour * min(1.0, uBrightness * uCursorBoost), shade(ring));
  }

  fragColour = vec4(colour, 1.0);
}
