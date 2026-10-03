import {
  MAX_FRAME_LOG,
  MAX_LOG_SCALE,
  MAX_ZOOM_TAU,
  MAX_ZOOM_TOLERANCE,
  MIN_FRAME_LOG,
  MIN_LOG_SCALE,
} from '../camera/framing';
import type { BlendMode, BoidStyle, StrokeKey } from '../render/boid-style';
import { BOID_PRESETS, DEFAULT_BOID_STYLE, STROKE_KEYS } from '../render/boid-style';
import { formatFramePercent } from '../render/overlay';
import type { SimParams } from '../sim/params';
import { DEFAULT_SIM_PARAMS } from '../sim/params';
import type { FlockPreset } from '../sim/presets';
import { FLOCK_BEHAVIOUR_KEYS, FLOCK_PRESETS, flockBehaviour } from '../sim/presets';

export type CursorMode = 'nothing' | 'predator' | 'attractor';

export const CURSOR_MODES: readonly CursorMode[] = ['nothing', 'predator', 'attractor'];

/** What each mode contributes to the sign of `SimParams.cursorStrength`. */
const CURSOR_SIGN: Record<CursorMode, number> = {
  nothing: 0,
  predator: -1,
  attractor: 1,
};

/** The mode after `mode` in `CURSOR_MODES`, wrapping round to the first. */
export function nextCursorMode(mode: CursorMode): CursorMode {
  return CURSOR_MODES[(CURSOR_MODES.indexOf(mode) + 1) % CURSOR_MODES.length];
}

/**
 * The force a held key switches to: the opposite of the set mode, or repel
 * when the set mode is nothing.
 */
export function heldCursorMode(mode: CursorMode): CursorMode {
  return mode === 'predator' ? 'attractor' : 'predator';
}

export type FlockSettings = Omit<SimParams, 'cursorStrength'>;

export interface CursorSettings {
  /**
   * `nothing` is a mode rather than a zero strength, so putting the cursor down
   * keeps the strength you set and hides the ring.
   */
  mode: CursorMode;
  /** Magnitude only, never negative. The mode supplies the sign. */
  strength: number;
}

export interface CameraSettings {
  /** Follow owns both the centre and the zoom. With it off, both are yours. */
  follow: boolean;
  /** Zoom while follow is off, as log10 CSS pixels per world unit. */
  logScale: number;
  /**
   * Zoom while follow is on: log10 of the fraction of the flock's size that
   * fills the frame. 0 is a plain fit, below it you fly inside the flock, and
   * above it the flock shrinks to a speck on the grid.
   */
  frameLog: number;
  /** How far the framing may drift, in decades, before the zoom follows it. */
  zoomTolerance: number;
  /** Time constant of the follow zoom, in seconds. */
  zoomTau: number;
}

export interface LookSettings extends Record<StrokeKey, number> {
  /** Name of a `BOID_PRESETS` entry. */
  boid: string;
  trails: boolean;
  blend: BlendMode;
}

/** Slider ranges for the stroke settings, which stored values are clamped to. */
export const STROKE_RANGES: Record<StrokeKey, { min: number; max: number; step: number }> = {
  lineWidth: { min: 0.5, max: 4, step: 0.05 },
  trailWidth: { min: 0, max: 3, step: 0.05 },
  trailBrightness: { min: 0, max: 1.5, step: 0.01 },
  trailFalloff: { min: 0.2, max: 5, step: 0.05 },
  glow: { min: 0, max: 1, step: 0.01 },
  glowRadius: { min: 0.1, max: 5, step: 0.05 },
};

/** Simulation steps per second that `ClockSettings.stepRate` may take. */
export const STEP_RATES: readonly number[] = [60, 90, 120];

export interface ClockSettings {
  /**
   * Simulation steps per second. The step cost is the same at any rate, so 60
   * costs half of what 120 does.
   */
  stepRate: number;
}

export interface Settings {
  flock: FlockSettings;
  clock: ClockSettings;
  cursor: CursorSettings;
  camera: CameraSettings;
  look: LookSettings;
}

/** Every default is read from the module that owns it, never spelled out here. */
export function defaultSettings(): Settings {
  const { cursorStrength, ...flock } = DEFAULT_SIM_PARAMS;
  return {
    flock: { ...flock },
    clock: { stepRate: 120 },
    cursor: {
      mode: cursorStrength === 0 ? 'nothing' : cursorStrength < 0 ? 'predator' : 'attractor',
      strength: Math.abs(cursorStrength),
    },
    camera: { follow: true, logScale: 0, frameLog: 0, zoomTolerance: 0.05, zoomTau: 0.8 },
    look: {
      boid: DEFAULT_BOID_STYLE.name,
      trails: DEFAULT_BOID_STYLE.trail !== 'none',
      blend: DEFAULT_BOID_STYLE.blend,
      ...strokeOf(DEFAULT_BOID_STYLE),
    },
  };
}

/** `mode` is for a held key, which changes the force without changing the settings. */
export function simParams(settings: Settings, mode = settings.cursor.mode): SimParams {
  return {
    ...settings.flock,
    cursorStrength: Math.abs(settings.cursor.strength) * CURSOR_SIGN[mode],
  };
}

/** How far the cursor force reaches, in world units, or 0 when it is off. */
export function cursorRadius(settings: Settings, mode = settings.cursor.mode): number {
  if (mode === 'nothing' || settings.cursor.strength <= 0) return 0;
  return Math.max(0, settings.flock.cursorRadius);
}

/** Writes a preset's rules over the set, leaving everything else alone. */
export function applyFlockPreset(flock: FlockSettings, preset: FlockPreset): void {
  Object.assign(flock, flockBehaviour(preset));
}

/**
 * Which preset the set is on, or `custom` once a slider has moved.
 *
 * It compares the values rather than remembering a name, so a stored set comes
 * back named, and a slider that lands back on a preset's value picks that name
 * up again.
 */
export function flockPresetName(flock: FlockSettings): string {
  const match = FLOCK_PRESETS.find((preset) =>
    FLOCK_BEHAVIOUR_KEYS.every((key) => flock[key] === preset[key]),
  );
  return match?.name ?? 'custom';
}

export function findPreset<T extends { readonly name: string }>(
  presets: readonly T[],
  name: string,
  fallback: T,
): T {
  return presets.find((preset) => preset.name === name) ?? fallback;
}

/**
 * Boid presets with the panel's overrides on them, cached.
 *
 * `boids.draw` reads a style into scalars and keeps nothing, so building one
 * per frame would work and would be garbage nobody asked for. The same few
 * combinations recur, so the map stays tiny.
 */
const boidVariants = new Map<string, Readonly<BoidStyle>>();

function strokeOf(style: Readonly<Record<StrokeKey, number>>): Record<StrokeKey, number> {
  const stroke = {} as Record<StrokeKey, number>;
  for (const key of STROKE_KEYS) stroke[key] = style[key];
  return stroke;
}

export function applyLook(base: Readonly<BoidStyle>, look: LookSettings): Readonly<BoidStyle> {
  const trail = look.trails ? base.trail : 'none';
  if (
    trail === base.trail &&
    look.blend === base.blend &&
    STROKE_KEYS.every((key) => look[key] === base[key])
  ) {
    return base;
  }

  const stroke = STROKE_KEYS.map((key) => look[key]).join('|');
  const key = `${base.name}|${trail}|${look.blend}|${stroke}`;
  let variant = boidVariants.get(key);
  if (!variant) {
    variant = Object.freeze({
      ...base,
      trail,
      blend: look.blend,
      ...strokeOf(look),
    } satisfies BoidStyle);
    boidVariants.set(key, variant);
  }
  return variant;
}

export function boidStyle(look: LookSettings): Readonly<BoidStyle> {
  return applyLook(findPreset(BOID_PRESETS, look.boid, DEFAULT_BOID_STYLE), look);
}

/**
 * Bump this when a stored set can no longer be read. Anything older is thrown
 * away rather than migrated: a set takes seconds to slide back.
 */
const STORAGE_VERSION = 1;

export function serialise(settings: Settings): string {
  return JSON.stringify({ version: STORAGE_VERSION, settings });
}

/**
 * A stored set merged over the defaults, or the defaults alone.
 *
 * Each field falls back on its own, so one bad value does not cost the set.
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

  const clock = from.clock;
  if (isRecord(clock) && STEP_RATES.includes(num(clock.stepRate, NaN))) {
    settings.clock.stepRate = num(clock.stepRate, settings.clock.stepRate);
  }

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
    settings.camera.frameLog = clamp(
      num(camera.frameLog, settings.camera.frameLog),
      MIN_FRAME_LOG,
      MAX_FRAME_LOG,
    );
    settings.camera.zoomTolerance = clamp(
      num(camera.zoomTolerance, settings.camera.zoomTolerance),
      0,
      MAX_ZOOM_TOLERANCE,
    );
    settings.camera.zoomTau = clamp(num(camera.zoomTau, settings.camera.zoomTau), 0, MAX_ZOOM_TAU);
  }

  const look = from.look;
  if (isRecord(look)) {
    settings.look.boid = oneOf(
      look.boid,
      BOID_PRESETS.map((preset) => preset.name),
      settings.look.boid,
    );
    settings.look.trails = bool(look.trails, settings.look.trails);
    settings.look.blend = oneOf(look.blend, ['additive', 'alpha'] as const, settings.look.blend);
    for (const key of STROKE_KEYS) {
      const { min, max } = STROKE_RANGES[key];
      settings.look[key] = clamp(num(look[key], settings.look[key]), min, max);
    }
  }

  return settings;
}

/** A set that shares nothing with the one it was taken from. */
export function cloneSettings(settings: Settings): Settings {
  return {
    flock: { ...settings.flock },
    clock: { ...settings.clock },
    cursor: { ...settings.cursor },
    camera: { ...settings.camera },
    look: { ...settings.look },
  };
}

/**
 * Writes through the objects inside `target` rather than replacing them. The
 * panel binds to those objects and holds them for as long as it lives.
 */
export function copyInto(target: Settings, source: Settings): void {
  Object.assign(target.flock, source.flock);
  Object.assign(target.clock, source.clock);
  Object.assign(target.cursor, source.cursor);
  Object.assign(target.camera, source.camera);
  Object.assign(target.look, source.look);
}

/**
 * The set as a `SimParams` literal, ready to paste into `sim/params.ts`.
 *
 * A string rather than an object, because a console prints an object as a tree
 * that copies back as something nobody can read.
 */
export function exportLiteral(settings: Settings): string {
  const params = simParams(settings);
  const keys = Object.keys(DEFAULT_SIM_PARAMS) as (keyof SimParams)[];
  const lines = keys.map((key) => `  ${key}: ${short(params[key])},`);

  const { camera, look } = settings;
  return [
    '// web-flock parameters',
    `// look ${look.boid} · trails ${look.trails ? 'on' : 'off'} · ${look.blend}`,
    `// stroke ${STROKE_KEYS.map((key) => `${key} ${short(look[key])}`).join(' · ')}`,
    camera.follow
      ? `// follow on · frame ${formatFramePercent(camera.frameLog)} · cursor ${settings.cursor.mode}`
      : `// follow off · zoom ${(10 ** camera.logScale).toPrecision(3)} px/u` +
        ` · cursor ${settings.cursor.mode}`,
    '{',
    ...lines,
    '}',
  ].join('\n');
}

/**
 * Six significant figures, with no trailing zeros. An angle that `sim/params.ts`
 * writes as a fraction of pi comes out as `2.0944`, which is what the
 * simulation was running.
 */
function short(value: number): string {
  return String(Number(value.toPrecision(6)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Copies finite numbers for the keys `into` already has, and nothing else. */
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
