import { MAX_LOG_SCALE, MIN_LOG_SCALE } from '../camera/framing';
import type { BlendMode, BoidStyle } from '../render/boid-style';
import { BOID_PRESETS, DEFAULT_BOID_STYLE } from '../render/boid-style';
import type { GridStyle } from '../render/grid-style';
import { DEFAULT_GRID_STYLE, GRID_PRESETS } from '../render/grid-style';
import type { LabelFormat, LabelPlacement } from '../render/overlay';
import { DEFAULT_OVERLAY_OPTIONS } from '../render/overlay';
import type { SimParams } from '../sim/params';
import { DEFAULT_SIM_PARAMS } from '../sim/params';

export type CursorMode = 'nothing' | 'predator' | 'attractor';

export const CURSOR_MODES: readonly CursorMode[] = ['nothing', 'predator', 'attractor'];

/** What each mode contributes to the sign of `SimParams.cursorStrength`. */
const CURSOR_SIGN: Record<CursorMode, number> = {
  nothing: 0,
  predator: -1,
  attractor: 1,
};

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
  follow: boolean;
  /** Zoom, as log10 CSS pixels per world unit. Follow never touches it. */
  logScale: number;
}

export interface LookSettings {
  /** Name of a `BOID_PRESETS` entry. */
  boid: string;
  trails: boolean;
  blend: BlendMode;
  floorFade: number;

  /** Name of a `GRID_PRESETS` entry. */
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

/** Every default is read from the module that owns it, never spelled out here. */
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

export function simParams(settings: Settings): SimParams {
  return {
    ...settings.flock,
    cursorStrength: Math.abs(settings.cursor.strength) * CURSOR_SIGN[settings.cursor.mode],
  };
}

/** How far the cursor force reaches, in world units, or 0 when it is off. */
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
 * Boid presets with the panel's overrides on them, cached.
 *
 * `boids.draw` reads a style into scalars and keeps nothing, so building one
 * per frame would work and would be garbage nobody asked for. The same few
 * combinations recur, so the map stays tiny.
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

export function boidStyle(look: LookSettings): Readonly<BoidStyle> {
  return applyLook(findPreset(BOID_PRESETS, look.boid, DEFAULT_BOID_STYLE), look);
}

export function gridStyle(look: LookSettings): Readonly<GridStyle> {
  return findPreset(GRID_PRESETS, look.grid, DEFAULT_GRID_STYLE);
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
    settings.look.floorFade = clamp(num(look.floorFade, settings.look.floorFade), 0, 2);
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
 * Writes through the objects inside `target` rather than replacing them. The
 * panel binds to those objects and holds them for as long as it lives.
 */
export function copyInto(target: Settings, source: Settings): void {
  Object.assign(target.flock, source.flock);
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
    `// look ${look.boid} on ${look.grid} · trails ${look.trails ? 'on' : 'off'} · ${look.blend}`,
    `// zoom ${(10 ** camera.logScale).toPrecision(3)} px/u · follow ${camera.follow ? 'on' : 'off'}` +
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
