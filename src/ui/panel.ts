import type { FolderApi } from '@tweakpane/core';
import { Pane } from 'tweakpane';

import { MAX_LOG_SCALE, MIN_LOG_SCALE } from '../camera/framing';
import { BOID_PRESETS } from '../render/boid-style';
import { GRID_PRESETS } from '../render/grid-style';
import { formatScale } from '../render/overlay';
import type { Settings } from './settings';
import { CURSOR_MODES } from './settings';

/**
 * The parameter panel.
 *
 * Tweakpane, which PLAN.md picks for iteration one and leaves 7b to replace if
 * it is worth it. Everything the app can be told to do is here — the flock, the
 * cursor, the camera and the look — because a knob you have to remember a key
 * for is a knob a stranger never finds, and step 5's success criterion is that
 * dragging something visibly changes the motion within a second or two.
 *
 * Two things the panel deliberately does not own:
 *
 * - **The values.** It binds to the live {@link Settings} object and mutates it
 *   in place. Nothing is copied out and copied back, so the wheel and the
 *   preset keys can write to the same object and a {@link Panel.refresh} is all
 *   it takes for the panel to agree with them.
 * - **What a change means.** It calls `apply` and lets the app decide. The
 *   panel knows nothing about the simulation or the renderer.
 *
 * **Ranges here are provisional.** PLAN.md is explicit that they are revised in
 * 7a, once there is something to tune against, and that a range which is mostly
 * dead zone makes the simulation feel broken when it is not. These are wide
 * enough to find the interesting region rather than narrow enough to live in.
 */

/** Degrees, for an angle the simulation keeps in radians. */
const DEGREES = (value: number): string => `${((value * 180) / Math.PI).toFixed(0)}°`;

export interface PanelHooks {
  /**
   * The settings changed.
   *
   * Fires on every step of a drag, because PLAN.md's fifth success criterion is
   * that dragging a parameter visibly changes the motion within a second or
   * two, and waiting for the mouse button would cost exactly that. `committed`
   * is true only on the last change of an interaction, which is when a set is
   * worth writing to storage.
   */
  apply(committed: boolean): void;
  /** Centres on the flock and zooms to fit it, without turning follow on. */
  frameFlock(): void;
  /** Re-seeds the flock, which is the only thing `spawnRadius` can affect. */
  restart(): void;
  /** Writes the set to the console in a shape that survives being pasted. */
  exportSettings(): void;
  /** Clears the stored set and puts every value back to its default. */
  reset(): void;
}

export interface PanelOptions {
  /** Where the panel is mounted. See the `#panel` element in the page. */
  container: HTMLElement;
  /** The live settings. Bound to, and mutated in place. */
  settings: Settings;
  /** Upper bound on the count slider: what the simulation's arrays hold. */
  capacity: number;
  hooks: PanelHooks;
}

export interface Panel {
  /**
   * True when something in the panel has the keyboard.
   *
   * Every global key in this app is a bare letter, so without this, typing a
   * number into a Tweakpane field would also toggle the design harness and
   * re-centre the camera.
   */
  readonly capturesKeys: boolean;
  /** Re-reads the settings. For changes made by the wheel or the preset keys. */
  refresh(): void;
  dispose(): void;
}

/** `{ value: value }`, which is how Tweakpane spells a list of plain strings. */
function listOf(values: readonly string[]): Record<string, string> {
  return Object.fromEntries(values.map((value) => [value, value]));
}

/** The same, for a list of presets. */
function presetOptions(presets: readonly { readonly name: string }[]): Record<string, string> {
  return listOf(presets.map((preset) => preset.name));
}

export function createPanel(options: PanelOptions): Panel {
  const { container, settings, capacity, hooks } = options;
  const { flock, cursor, camera, look } = settings;

  const pane = new Pane({ container, title: 'web-flock', expanded: false });

  const flockFolder: FolderApi = pane.addFolder({ title: 'flock', expanded: true });
  flockFolder.addBinding(flock, 'count', { min: 0, max: capacity, step: 10 });
  flockFolder.addBinding(flock, 'separationRadius', {
    label: 'separation r',
    min: 0,
    max: 40,
    step: 0.5,
  });
  flockFolder.addBinding(flock, 'neighbourRadius', {
    label: 'neighbour r',
    min: 2,
    max: 80,
    step: 0.5,
  });
  flockFolder.addBinding(flock, 'fieldOfView', {
    label: 'half fov',
    min: 0,
    max: Math.PI,
    step: 0.01,
    format: DEGREES,
  });
  flockFolder.addBinding(flock, 'separationWeight', {
    label: 'separation',
    min: 0,
    max: 3,
    step: 0.01,
  });
  flockFolder.addBinding(flock, 'alignmentWeight', {
    label: 'alignment',
    min: 0,
    max: 3,
    step: 0.01,
  });
  flockFolder.addBinding(flock, 'cohesionWeight', {
    label: 'cohesion',
    min: 0,
    max: 3,
    step: 0.01,
  });
  flockFolder.addBinding(flock, 'maxForce', { label: 'max force', min: 0, max: 400, step: 1 });
  flockFolder.addBinding(flock, 'originPull', {
    label: 'origin pull',
    min: 0,
    max: 0.2,
    step: 0.001,
  });
  flockFolder.addBinding(flock, 'minSpeed', { label: 'min speed', min: 0, max: 100, step: 1 });
  flockFolder.addBinding(flock, 'maxSpeed', { label: 'max speed', min: 0, max: 200, step: 1 });
  flockFolder.addBinding(flock, 'maxTurnRate', {
    label: 'turn rate',
    min: 0,
    max: Math.PI * 4,
    step: 0.01,
    format: (value: number) => `${DEGREES(value)}/s`,
  });
  flockFolder.addBinding(flock, 'wanderStrength', { label: 'wander', min: 0, max: 40, step: 0.1 });
  flockFolder.addBinding(flock, 'wanderRate', { label: 'wander rate', min: 0, max: 10, step: 0.1 });

  // Only bites on a re-seed, so the button that makes it mean anything sits
  // next to it rather than somewhere else.
  flockFolder.addBinding(flock, 'spawnRadius', { label: 'spawn r', min: 10, max: 2000, step: 10 });
  flockFolder.addButton({ title: 'restart' }).on('click', () => {
    hooks.restart();
  });

  const cursorFolder = pane.addFolder({ title: 'cursor', expanded: true });
  // A dropdown rather than radio buttons: Tweakpane has no radio control
  // without a plugin, and three named options in a list read the same way. What
  // matters is that `nothing` is one of them, so the cursor can be put down
  // rather than turned to zero and left ambiguous.
  cursorFolder.addBinding(cursor, 'mode', { options: listOf(CURSOR_MODES) });
  cursorFolder.addBinding(cursor, 'strength', { min: 0, max: 2000, step: 10 });
  cursorFolder.addBinding(flock, 'cursorRadius', { label: 'radius', min: 0, max: 400, step: 5 });

  const cameraFolder = pane.addFolder({ title: 'camera', expanded: true });
  cameraFolder.addBinding(camera, 'follow');
  // Bound straight to the camera's own unit. Zoom is already held as a
  // logarithm — see `camera/camera.ts` — so the slider is linear in the thing
  // that should be linear, and only the label has to be translated.
  cameraFolder.addBinding(camera, 'logScale', {
    label: 'zoom',
    min: MIN_LOG_SCALE,
    max: MAX_LOG_SCALE,
    format: (value: number) => formatScale(10 ** value),
  });
  cameraFolder.addButton({ title: 'frame flock' }).on('click', () => {
    hooks.frameFlock();
  });

  const lookFolder = pane.addFolder({ title: 'look', expanded: false });
  lookFolder.addBinding(look, 'boid', { label: 'palette', options: presetOptions(BOID_PRESETS) });
  lookFolder.addBinding(look, 'trails');
  lookFolder.addBinding(look, 'blend', { options: { additive: 'additive', alpha: 'alpha' } });
  lookFolder.addBinding(look, 'floorFade', { label: 'floor fade', min: 0, max: 2, step: 1 });
  lookFolder.addBinding(look, 'grid', { options: presetOptions(GRID_PRESETS) });
  lookFolder.addBinding(look, 'labels', { options: { edge: 'edge', axis: 'axis' } });
  lookFolder.addBinding(look, 'labelFormat', {
    label: 'format',
    options: { compact: 'compact', plain: 'plain' },
  });

  pane.addButton({ title: 'export to console' }).on('click', () => {
    hooks.exportSettings();
  });
  pane.addButton({ title: 'reset to defaults' }).on('click', () => {
    hooks.reset();
  });

  pane.on('change', (event) => {
    hooks.apply(event.last);
  });

  const refresh = (): void => {
    pane.refresh();
  };

  return {
    get capturesKeys(): boolean {
      const focused = document.activeElement;
      return focused !== null && pane.element.contains(focused);
    },

    refresh,

    dispose(): void {
      pane.dispose();
    },
  };
}
