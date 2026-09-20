import type { Camera } from '../camera/camera';
import type { Vec2 } from '../math/types';
import { createResizingCanvas } from './canvas';
import type { FrameStats } from './frame-stats';
import type { GridStyle } from './grid-style';

/**
 * The text layer: edge tick labels, the coordinate readout, and comparison
 * mode's captions.
 *
 * A second canvas over the WebGL one, drawn with the 2D context. Text is the
 * one thing a GPU is bad at without a pile of machinery — a glyph atlas, a
 * layout pass, a shader — and none of that machinery would buy anything here,
 * because these few dozen numbers never need to be inside the scene. The 2D
 * context renders them at native resolution with the platform's own hinting,
 * for a `clearRect` and some `fillText` a frame.
 *
 * The overlay takes no pointer events (`pointer-events: none` in the page), so
 * the canvas underneath keeps receiving them.
 */

/** Where tick labels sit. An open question in PLAN.md, so both are built. */
export type LabelPlacement = 'edge' | 'axis';

/** How tick values read. The other open question: `1200` against `1.2k`. */
export type LabelFormat = 'plain' | 'compact';

export interface OverlayOptions {
  placement: LabelPlacement;
  format: LabelFormat;
  /**
   * Minimum CSS pixels between labelled ticks. Sets which decade gets labelled
   * and therefore how crowded the edges are — the labels' equivalent of the
   * grid's `minPixelSpacing`, and much larger, because a number needs far more
   * room than a line.
   */
  minSpacing: number;
  /** CSS pixels. */
  fontSize: number;
}

/**
 * Both taste calls PLAN.md left open for step 3, settled by eye: labels on the
 * screen edge, and `1.2k` rather than `1200`. The losing options stay
 * reachable — they are a branch each, and step 7b looks at all of this again
 * against the finished renderer.
 */
export const DEFAULT_OVERLAY_OPTIONS: OverlayOptions = {
  placement: 'edge',
  format: 'compact',
  minSpacing: 90,
  fontSize: 11,
};

/** What the readout says about the boids. Null before anything draws them. */
export interface BoidReadout {
  readonly styleName: string;
  /** Drawn with the frame time rather than with the style: it is what the
      frame time costs. */
  readonly count: number;
}

export interface OverlayFrame {
  camera: Camera;
  /** World-space cursor, or null when it is not over the canvas. */
  cursor: Readonly<Vec2> | null;
  style: Readonly<GridStyle>;
  /** Null when nothing is drawing boids, which hides the line. */
  boid: BoidReadout | null;
  /**
   * Comparison mode: the four captions in reading order, top-left first. Null
   * for an ordinary frame, which is what draws tick labels.
   */
  quadrants: readonly string[] | null;
  /** One dim line of key bindings along the bottom. Empty hides it. */
  help: string;
  /** The frame-time HUD, top right. Null hides it. */
  stats: FrameStats | null;
}

export interface Overlay {
  /** Mutable: the controls in `dev/` write to it and the next frame picks it up. */
  readonly options: OverlayOptions;
  draw(frame: OverlayFrame): void;
  dispose(): void;
}

const LABEL_COLOUR = '212, 238, 255';
const READOUT_COLOUR = 'rgba(150, 205, 235, 0.9)';
const HELP_COLOUR = 'rgba(120, 165, 190, 0.55)';
const SEPARATOR_COLOUR = 'rgba(190, 225, 245, 0.22)';
const HALO = 'rgba(0, 0, 0, 0.8)';

/**
 * A 60 fps frame is 16.7 ms. The first threshold sits just above it so that
 * ordinary jitter does not flicker the colour, and the second marks the point
 * where the display has certainly dropped a frame.
 */
const FRAME_OK_MS = 17.5;
const FRAME_WARN_MS = 25;
const FRAME_COLOURS = [
  'rgba(150, 225, 200, 0.95)',
  'rgba(255, 205, 120, 0.95)',
  'rgba(255, 135, 120, 0.95)',
];

const MARGIN = 8;

export function createOverlay(
  canvasElement: HTMLCanvasElement,
  options: OverlayOptions = { ...DEFAULT_OVERLAY_OPTIONS },
): Overlay {
  const surface = createResizingCanvas(canvasElement);
  const ctx = canvasElement.getContext('2d');
  if (!ctx) throw new Error('2D context is not available for the overlay canvas');

  const scratch: Vec2 = { x: 0, y: 0 };

  /** Text with a dark halo, so it stays readable where it crosses a grid line. */
  const label = (text: string, x: number, y: number, alpha: number): void => {
    if (alpha <= 0.01) return;
    ctx.strokeStyle = HALO;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = `rgba(${LABEL_COLOUR}, ${alpha.toFixed(3)})`;
    ctx.fillText(text, x, y);
  };

  const drawTicks = (frame: OverlayFrame): void => {
    const { camera } = frame;
    const { placement, format, minSpacing } = options;
    const width = camera.viewportWidth;
    const height = camera.viewportHeight;

    // The finest decade whose ticks are at least `minSpacing` apart, found the
    // same way the grid finds its finest visible decade.
    const exponent = Math.ceil(Math.log10(minSpacing / camera.scale));
    const step = 10 ** exponent;
    const spacing = step * camera.scale;

    // Ticks that are not also ticks of the next decade up are the ones that
    // have just appeared, so they fade in as they gain room, exactly as the
    // grid lines under them do. Without this the whole set of labels would
    // blink into existence at once.
    const fine = smoothstep(minSpacing, minSpacing * 2.5, spacing);

    const bounds = camera.visibleBounds();
    ctx.font = `${options.fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

    const origin = camera.worldToScreen(0, 0, scratch);
    const axisY = clamp(origin.y + 4, MARGIN + options.fontSize, height - MARGIN);
    const axisX = clamp(origin.x + 5, MARGIN, width - 48);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const labelY = placement === 'edge' ? height - MARGIN : axisY + options.fontSize;
    for (let i = Math.ceil(bounds.minX / step); i <= Math.floor(bounds.maxX / step); i++) {
      const value = i * step;
      const x = camera.worldToScreen(value, 0, scratch).x;
      label(formatTick(value, exponent, format), x, labelY, i % 10 === 0 ? 1 : fine);
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const labelX = placement === 'edge' ? MARGIN : axisX;
    for (let i = Math.ceil(bounds.minY / step); i <= Math.floor(bounds.maxY / step); i++) {
      // On the axis the two zeroes would sit on top of each other; the x axis
      // keeps it.
      if (i === 0 && placement === 'axis') continue;
      const value = i * step;
      const y = camera.worldToScreen(0, value, scratch).y;
      label(formatTick(value, exponent, format), labelX, y, i % 10 === 0 ? 1 : fine);
    }
  };

  const drawReadout = (frame: OverlayFrame): void => {
    const { camera, cursor } = frame;
    // Show coordinates to the precision the current zoom actually resolves:
    // more decimals when a pixel is a small piece of the world, none when it
    // is a large one.
    const decimals = clamp(Math.ceil(Math.log10(camera.scale)) + 1, 0, 6);
    const gridExponent = Math.ceil(Math.log10(options.minSpacing / camera.scale));

    const lines = [
      cursor ? `cursor  ${cursor.x.toFixed(decimals)}, ${cursor.y.toFixed(decimals)}` : 'cursor  —',
      `centre  ${camera.center.x.toFixed(decimals)}, ${camera.center.y.toFixed(decimals)}`,
      `grid    ${formatTick(10 ** gridExponent, gridExponent, options.format)} · ${formatScale(camera.scale)}`,
      `style   ${frame.style.name}`,
      ...(frame.boid ? [`boid    ${frame.boid.styleName}`] : []),
    ];

    ctx.font = `${options.fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = READOUT_COLOUR;
    const lineHeight = options.fontSize * 1.45;
    const right = camera.viewportWidth - MARGIN;
    let y = camera.viewportHeight - MARGIN - (lines.length - 1) * lineHeight;
    for (const line of lines) {
      ctx.strokeStyle = HALO;
      ctx.lineWidth = 3;
      ctx.strokeText(line, right, y);
      ctx.fillText(line, right, y);
      y += lineHeight;
    }
  };

  const drawQuadrants = (frame: OverlayFrame, captions: readonly string[]): void => {
    const width = frame.camera.viewportWidth;
    const height = frame.camera.viewportHeight;
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    ctx.strokeStyle = SEPARATOR_COLOUR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(halfWidth, 0);
    ctx.lineTo(halfWidth, height);
    ctx.moveTo(0, halfHeight);
    ctx.lineTo(width, halfHeight);
    ctx.stroke();

    ctx.font = `${options.fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const corners = [
      { x: MARGIN, y: MARGIN },
      { x: halfWidth + MARGIN, y: MARGIN },
      { x: MARGIN, y: halfHeight + MARGIN },
      { x: halfWidth + MARGIN, y: halfHeight + MARGIN },
    ];
    for (let i = 0; i < corners.length && i < captions.length; i++) {
      label(captions[i], corners[i].x, corners[i].y, 0.95);
    }
  };

  /**
   * The frame-time HUD. Colour-coded because the question it answers is "is it
   * still 60" — which should be readable at a glance, while the eye is on the
   * flock rather than on the digits.
   */
  const drawStats = (frame: OverlayFrame, stats: FrameStats): void => {
    const severity = stats.frameMs <= FRAME_OK_MS ? 0 : stats.frameMs <= FRAME_WARN_MS ? 1 : 2;
    const lines = [
      `${stats.fps.toFixed(0).padStart(3)} fps${stats.behind ? '  behind' : ''}`,
      `frame ${stats.frameMs.toFixed(1)} ms   worst ${stats.worstFrameMs.toFixed(1)}`,
      `sim   ${stats.simMs.toFixed(1)} ms   ×${stats.steps}`,
      ...(frame.boid ? [`boids ${frame.boid.count}`] : []),
    ];

    ctx.font = `${options.fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.strokeStyle = HALO;
    ctx.lineWidth = 3;
    const right = frame.camera.viewportWidth - MARGIN;
    let y = MARGIN;
    for (let i = 0; i < lines.length; i++) {
      // Only the headline carries the colour; the detail lines stay neutral so
      // the warning reads as one signal rather than three.
      ctx.fillStyle = i === 0 ? FRAME_COLOURS[severity] : READOUT_COLOUR;
      ctx.strokeText(lines[i], right, y);
      ctx.fillText(lines[i], right, y);
      y += options.fontSize * 1.45;
    }
  };

  return {
    options,

    draw(frame: OverlayFrame): void {
      const { width, height, pixelRatio } = surface.size;
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      if (frame.quadrants) {
        // Per-quadrant tick labels would be four sets of numbers competing for
        // the same few hundred pixels, and the variants differ in the lines,
        // not the labels. Captions only.
        drawQuadrants(frame, frame.quadrants);
      } else {
        drawTicks(frame);
      }

      drawReadout(frame);
      if (frame.stats) drawStats(frame, frame.stats);

      if (frame.help) {
        ctx.font = `${options.fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = HELP_COLOUR;
        ctx.fillText(frame.help, MARGIN, height - MARGIN);
      }
    },

    dispose(): void {
      surface.dispose();
    },
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

const COMPACT_UNITS = [
  { at: 1e9, suffix: 'G' },
  { at: 1e6, suffix: 'M' },
  { at: 1e3, suffix: 'k' },
] as const;

/**
 * `exponent` is the decade the tick belongs to, and it is what decides how many
 * digits are meaningful: at a step of 100 there is nothing after the point to
 * say, and at a step of 0.01 there are two digits that matter.
 */
export function formatTick(value: number, exponent: number, format: LabelFormat): string {
  if (value === 0) return '0';

  // Before the suffixes, not after: the largest suffix is G, so a compact
  // format left to its own devices answers 1e12 with `1000G` and 1e15 with
  // `1000000G`, which is worse than the exponential it was meant to avoid.
  if (exponent <= -5 || Math.abs(value) >= 1e12) {
    return value.toExponential(0).replace('e+', 'e');
  }

  if (format === 'compact') {
    const magnitude = Math.abs(value);
    for (const unit of COMPACT_UNITS) {
      if (magnitude >= unit.at) {
        const decimals = clamp(Math.round(Math.log10(unit.at)) - exponent, 0, 3);
        return trimZeros((value / unit.at).toFixed(decimals)) + unit.suffix;
      }
    }
  }

  return trimZeros(value.toFixed(clamp(-exponent, 0, 6)));
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** Reads as "how much world is a pixel", which is the useful direction. */
function formatScale(pixelsPerUnit: number): string {
  if (pixelsPerUnit >= 1) return `${trimZeros(pixelsPerUnit.toPrecision(3))} px/u`;
  return `${trimZeros((1 / pixelsPerUnit).toPrecision(3))} u/px`;
}
