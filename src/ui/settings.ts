import { MAX_LOG_SCALE, MIN_LOG_SCALE } from '../camera/framing';
import type { BlendMode, BoidStyle } from '../render/boid-style';
import { BOID_PRESETS, DEFAULT_BOID_STYLE } from '../render/boid-style';
import type { GridStyle } from '../render/grid-style';
import { DEFAULT_GRID_STYLE, GRID_PRESETS } from '../render/grid-style';
import type { LabelFormat, LabelPlacement } from '../render/overlay';
import { DEFAULT_OVERLAY_OPTIONS } from '../render/overlay';
import type { SimParams } from '../sim/params';
import { DEFAULT_SIM_PARAMS } from '../sim/params';

/**
 * Everything the user can change, in one object.
 *
 * `SimParams` is what the *simulation* takes; this is what the *panel* holds,
 * and the two are deliberately not the same shape. Two differences, each for a
 * reason:
 *
 * 1. **The cursor's direction is a mode, not a sign.** `SimParams` carries one
 *    signed `cursorStrength` because that is the cheap thing for the step to
 *    read. A panel that exposed it raw would make "off" a particular point in
 *    the middle of a slider, and "predator or attractor" something you infer
 *    from a minus sign. So the panel holds a mode and a magnitude, and
 *    {@link simParams} multiplies them back together. `nothing` is a mode
 *    rather than a zero, which is why it can also turn the ring off.
 *
 * 2. **The look is preset names plus overrides**, not a resolved style. Storing
 *    a whole `BoidStyle` would freeze a copy of whatever the preset said on the
 *    day it was saved, so 7b's retuning of the presets would never reach a
 *    browser that had a saved set — the one thing persistence must not do.
 *
 * Everything here is plain data and serialises to JSON without translation,
 * which is the same property `sim/params.ts` was designed for.
 */

export type CursorMode = 'nothing' | 'predator' | 'attractor';

/** In panel order: off, then the two directions. */
export const CURSOR_MODES: readonly CursorMode[] = ['nothing', 'predator', 'attractor'];

/** What the mode contributes to `SimParams.cursorStrength`. */
const CURSOR_SIGN: Record<CursorMode, number> = {
  nothing: 0,
  predator: -1,
  attractor: 1,
};

/** The flock's parameters minus the cursor's direction. See the file comment. */
export type FlockSettings = Omit<SimParams, 'cursorStrength'>;

export interface CursorSettings {
  mode: CursorMode;
  /** Magnitude only, never negative: {@link CursorMode} supplies the sign. */
  strength: number;
}

export interface CameraSettings {
  /**
   * Whether the camera tracks the flock. With it off the pointer drags the
   * camera instead, and the flock is free to fly off screen.
   *
   * PLAN.md ruled out manual panning and any follow/override state machine.
   * This is a departure from the first and not the second: nothing ever
   * disengages follow behind your back, so there is no state to be surprised
   * by — it is on until you turn it off. Watching the flock leave turned out to
   * be worth having.
   */
  follow: boolean;
  /**
   * Zoom, as log10 CSS pixels per world unit — the camera's own unit.
   *
   * A number the camera *holds*, not one derived from the flock. PLAN.md asks
   * for a framing percentage recomputed from how far the flock spreads; that
   * was built and taken out again because it hunted, and `camera/framing.ts`
   * records why. Follow does not touch it, so toggling follow changes where the
   * camera points and never how far out it is.
   */
  logScale: number;
}

export interface LookSettings {
  /** Name of a {@link BOID_PRESETS} entry. Not a copy of one — see the file comment. */
  boid: string;
  trails: boolean;
  blend: BlendMode;
  floorFade: number;

  /** Name of a {@link GRID_PRESETS} entry. */
  grid: string;
  labels: LabelPlacement;
  labelFormat: LabelFormat;
}

export interface Settings {
  flock: FlockSettings;
  cursor: CursorSettings;
  camera: CameraSettings;
  look: LookSettings;
}

/**
 * A fresh, mutable set at the values the rest of the project calls default.
 *
 * Nothing is spelled out twice: the flock comes from `DEFAULT_SIM_PARAMS`, the
 * look from the first preset in each list, the labels from the overlay's own
 * defaults. A default that disagreed with the module that owns it would be a
 * silent way for 7a's tuning to stop reaching the app.
 */
export function defaultSettings(): Settings {
  const { cursorStrength, ...flock } = DEFAULT_SIM_PARAMS;
  return {
    flock: { ...flock },
    cursor: {
      mode: cursorStrength === 0 ? 'nothing' : cursorStrength < 0 ? 'predator' : 'attractor',
      strength: Math.abs(cursorStrength),
    },
    camera: { follow: true, logScale: 0 },
    look: {
      boid: DEFAULT_BOID_STYLE.name,
      trails: DEFAULT_BOID_STYLE.trail !== 'none',
      blend: DEFAULT_BOID_STYLE.blend,
      floorFade: DEFAULT_BOID_STYLE.floorFade,
      grid: DEFAULT_GRID_STYLE.name,
      labels: DEFAULT_OVERLAY_OPTIONS.placement,
      labelFormat: DEFAULT_OVERLAY_OPTIONS.format,
    },
  };
}

/** What the simulation takes. The cursor's mode and magnitude recombine here. */
export function simParams(settings: Settings): SimParams {
  return {
    ...settings.flock,
    cursorStrength: Math.abs(settings.cursor.strength) * CURSOR_SIGN[settings.cursor.mode],
  };
}

/** World radius the cursor force reaches, or 0 when it is doing nothing. */
export function cursorRadius(settings: Settings): number {
  if (settings.cursor.mode === 'nothing' || settings.cursor.strength <= 0) return 0;
  return Math.max(0, settings.flock.cursorRadius);
}

export function findPreset<T extends { readonly name: string }>(
  presets: readonly T[],
  name: string,
  fallback: T,
): T {
  return presets.find((preset) => preset.name === name) ?? fallback;
}

/**
 * The overrides the panel puts on top of whichever boid preset is selected.
 *
 * Cached by what it produces rather than rebuilt per frame: `boids.draw` reads
 * a style into scalars and keeps nothing, so a fresh object every frame would
 * be correct but would be garbage nobody asked for. The same few combinations
 * recur forever, so the map stays tiny.
 */
const boidVariants = new Map<string, Readonly<BoidStyle>>();

export function applyLook(base: Readonly<BoidStyle>, look: LookSettings): Readonly<BoidStyle> {
  const trail = look.trails ? base.trail : 'none';
  if (trail === base.trail && look.blend === base.blend && look.floorFade === base.floorFade) {
    return base;
  }

  const key = `${base.name}|${trail}|${look.blend}|${look.floorFade}`;
  let variant = boidVariants.get(key);
  if (!variant) {
    variant = Object.freeze({
      ...base,
      trail,
      blend: look.blend,
      floorFade: look.floorFade,
    } satisfies BoidStyle);
    boidVariants.set(key, variant);
  }
  return variant;
}

/** The boid style to draw an ordinary frame with. */
export function boidStyle(look: LookSettings): Readonly<BoidStyle> {
  return applyLook(findPreset(BOID_PRESETS, look.boid, DEFAULT_BOID_STYLE), look);
}

/** The grid style to draw an ordinary frame with. */
export function gridStyle(look: LookSettings): Readonly<GridStyle> {
  return findPreset(GRID_PRESETS, look.grid, DEFAULT_GRID_STYLE);
}

/**
 * Bumped when a stored set can no longer be read. Anything older is discarded
 * rather than guessed at — a set is a few seconds of sliding to recreate, and a
 * half-migrated one would be a slow lie rather than a fast loss.
 */
const STORAGE_VERSION = 1;

export function serialise(settings: Settings): string {
  return JSON.stringify({ version: STORAGE_VERSION, settings });
}

/**
 * A stored set, merged over the defaults; the defaults alone if there is
 * nothing usable.
 *
 * Every field is validated on the way in rather than trusted. The blob comes
 * from a browser store the user can edit, from an older build of this app, or
 * from a newer one that has been rolled back — so a `NaN` speed or a preset
 * name that no longer exists is an ordinary case, not an attack. Anything that
 * does not survive validation falls back to its default individually, so one
 * bad field does not cost the whole set.
 */
export function parse(text: string | null): Settings {
  const settings = defaultSettings();
  if (text === null || text === '') return settings;

  let stored: unknown;
  try {
    stored = JSON.parse(text);
  } catch {
    return settings;
  }

  if (!isRecord(stored) || stored.version !== STORAGE_VERSION) return settings;
  const from = stored.settings;
  if (!isRecord(from)) return settings;

  mergeNumbers(settings.flock, from.flock);

  const cursor = from.cursor;
  if (isRecord(cursor)) {
    settings.cursor.mode = oneOf(cursor.mode, CURSOR_MODES, settings.cursor.mode);
    settings.cursor.strength = Math.max(0, num(cursor.strength, settings.cursor.strength));
  }

  const camera = from.camera;
  if (isRecord(camera)) {
    settings.camera.follow = bool(camera.follow, settings.camera.follow);
    settings.camera.logScale = clamp(
      num(camera.logScale, settings.camera.logScale),
      MIN_LOG_SCALE,
      MAX_LOG_SCALE,
    );
  }

  const look = from.look;
  if (isRecord(look)) {
    // By name, and only a name that still exists: a preset renamed in 7b must
    // fall back to the default rather than leave the panel pointing at nothing.
    settings.look.boid = oneOf(
      look.boid,
      BOID_PRESETS.map((preset) => preset.name),
      settings.look.boid,
    );
    settings.look.grid = oneOf(
      look.grid,
      GRID_PRESETS.map((preset) => preset.name),
      settings.look.grid,
    );
    settings.look.trails = bool(look.trails, settings.look.trails);
    settings.look.blend = oneOf(look.blend, ['additive', 'alpha'] as const, settings.look.blend);
    settings.look.floorFade = clamp(num(look.floorFade, settings.look.floorFade), 0, 4);
    settings.look.labels = oneOf(look.labels, ['edge', 'axis'] as const, settings.look.labels);
    settings.look.labelFormat = oneOf(
      look.labelFormat,
      ['plain', 'compact'] as const,
      settings.look.labelFormat,
    );
  }

  return settings;
}

/**
 * Replaces every value in `target` with `source`'s, in place.
 *
 * In place because the panel binds to the objects *inside* a {@link Settings}
 * and holds those references for as long as it lives. Handing it a freshly
 * built set would leave every control pointing at the set the app used to have,
 * which is the shape a reset button most wants to take and the one that would
 * quietly stop working.
 */
export function copyInto(target: Settings, source: Settings): void {
  Object.assign(target.flock, source.flock);
  Object.assign(target.cursor, source.cursor);
  Object.assign(target.camera, source.camera);
  Object.assign(target.look, source.look);
}

/**
 * The set as a `SimParams` literal, ready to paste into `sim/params.ts` or into
 * a chat.
 *
 * PLAN.md asks for this so that "this one felt good" can become something
 * concrete in 7a. A string rather than an object for the same reason
 * `dev/readings.ts` prints one: a console renders an object as an interactive
 * tree that copies back as something nobody can read.
 *
 * The key order comes from `DEFAULT_SIM_PARAMS` itself, so the export reads
 * like the file it is destined for and cannot drift out of date when a
 * parameter is added.
 */
export function exportLiteral(settings: Settings): string {
  const params = simParams(settings);
  const keys = Object.keys(DEFAULT_SIM_PARAMS) as (keyof SimParams)[];
  const lines = keys.map((key) => `  ${key}: ${short(params[key])},`);

  const { camera, look } = settings;
  return [
    '// web-flock parameters',
    `// look ${look.boid} on ${look.grid} · trails ${look.trails ? 'on' : 'off'} · ${look.blend}`,
    `// zoom ${(10 ** camera.logScale).toPrecision(3)} px/u · follow ${camera.follow ? 'on' : 'off'}` +
      ` · cursor ${settings.cursor.mode}`,
    '{',
    ...lines,
    '}',
  ].join('\n');
}

/**
 * Six significant figures, with no trailing zeros.
 *
 * Exact enough to reproduce a look and short enough to read. Values like
 * `fieldOfView` are written as fractions of pi in `sim/params.ts` and come out
 * here as `2.0944`, which is the honest thing to hand back — it is the number
 * the simulation was actually running.
 */
function short(value: number): string {
  return String(Number(value.toPrecision(6)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Copies every finite number the target already has a key for, and nothing else. */
function mergeNumbers<T extends Record<string, number>>(into: T, from: unknown): void {
  if (!isRecord(from)) return;
  for (const key of Object.keys(into)) {
    const value = from[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      (into as Record<string, number>)[key] = value;
    }
  }
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
