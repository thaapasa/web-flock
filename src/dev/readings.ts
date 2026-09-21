/**
 * Frame-time readings, in a shape that survives being pasted back.
 *
 * `p` records the HUD as it stands and prints every reading so far, to copy
 * once at the end. A table rather than an object, because a console prints an
 * object as a tree that copies back as something nobody can read.
 */

/** One row: what the HUD said, and what was set when it said it. */
export interface Reading {
  readonly boids: number;
  readonly trails: boolean;
  readonly fps: number;
  readonly frameMs: number;
  readonly worstMs: number;
  readonly simMs: number;
  readonly steps: number;
  /** True when the frame loop had to drop time: already in slow motion. */
  readonly behind: boolean;
  /** CSS pixels per world unit. It sets how much the GPU has to fill. */
  readonly scale: number;
  /** The flock's density band: how crowded it was. */
  readonly band: number;
  readonly settings: ReadingSettings;
}

/** Everything a row depends on that is not in the row. */
export interface ReadingSettings {
  readonly viewport: string;
  readonly style: string;
  readonly trailPoints: number;
  readonly blend: string;
  readonly floorFade: number;
  readonly neighbourRadius: number;
  readonly separationRadius: number;
  readonly minSpeed: number;
  readonly maxSpeed: number;
}

export interface ReadingLog {
  /** Records a reading and returns every reading so far, ready to copy. */
  add(reading: Reading): string;
  clear(): void;
  readonly length: number;
}

const COLUMNS = [
  'boids',
  'trail',
  'fps',
  'frame',
  'worst',
  'sim',
  'steps',
  'px/u',
  'band',
] as const;
const WIDTHS = [6, 6, 6, 7, 7, 7, 6, 8, 6];

/** Ordered so a change always prints in the same place. */
function fields(settings: ReadingSettings): readonly (readonly [string, string])[] {
  return [
    ['viewport', settings.viewport],
    ['style', settings.style],
    ['trail', `${settings.trailPoints} pts`],
    ['blend', settings.blend],
    ['fade', String(settings.floorFade)],
    ['neighbour', String(settings.neighbourRadius)],
    ['separation', String(settings.separationRadius)],
    ['speed', `${settings.minSpeed}..${settings.maxSpeed}`],
  ];
}

/** Everything on the first row, and only what moved on the rest. */
function changes(settings: ReadingSettings, previous: ReadingSettings | null): string | null {
  const now = fields(settings);
  if (!previous) return now.map(([label, value]) => `${label} ${value}`).join(' · ');

  const before = new Map(fields(previous));
  const moved = now
    .filter(([label, value]) => before.get(label) !== value)
    .map(([label, value]) => `${label} ${value}`);
  return moved.length > 0 ? `→ ${moved.join(' · ')}` : null;
}

function row(cells: readonly string[]): string {
  return cells.map((cell, i) => cell.padStart(WIDTHS[i])).join('');
}

function format(readings: readonly Reading[], gpu: string): string {
  const lines = [`web-flock readings — ${gpu}`, ''];
  let previous: ReadingSettings | null = null;

  for (const reading of readings) {
    const changed = changes(reading.settings, previous);
    if (changed) {
      lines.push(changed);
      // The header follows the first settings line, so the columns are
      // established before any numbers appear under them.
      if (!previous) lines.push(row(COLUMNS));
    }
    previous = reading.settings;

    lines.push(
      row([
        String(reading.boids),
        reading.trails ? 'on' : 'off',
        reading.fps.toFixed(1),
        reading.frameMs.toFixed(1),
        reading.worstMs.toFixed(1),
        reading.simMs.toFixed(2),
        String(reading.steps),
        reading.scale >= 1 ? reading.scale.toFixed(2) : reading.scale.toFixed(4),
        reading.band.toFixed(0),
      ]) + (reading.behind ? '   behind' : ''),
    );
  }

  return lines.join('\n');
}

export function createReadingLog(gpu: string): ReadingLog {
  const readings: Reading[] = [];

  return {
    add(reading): string {
      readings.push(reading);
      return format(readings, gpu);
    },

    clear(): void {
      readings.length = 0;
    },

    get length() {
      return readings.length;
    },
  };
}

/**
 * What the GPU calls itself. A reading is worth much less without it, and a
 * browser may withhold the name, so an unknown one is normal.
 */
export function describeRenderer(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  if (!info) return 'unknown GPU';
  const renderer: unknown = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
  return typeof renderer === 'string' && renderer.length > 0 ? renderer : 'unknown GPU';
}
