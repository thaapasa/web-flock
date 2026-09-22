import type { FolderApi } from '@tweakpane/core';
import { Pane } from 'tweakpane';

import {
  MAX_FRAME_LOG,
  MAX_LOG_SCALE,
  MAX_ZOOM_TAU,
  MAX_ZOOM_TOLERANCE,
  MIN_FRAME_LOG,
  MIN_LOG_SCALE,
} from '../camera/framing';
import { BOID_PRESETS } from '../render/boid-style';
import { GRID_PRESETS } from '../render/grid-style';
import { formatFramePercent, formatScale } from '../render/overlay';
import type { Settings } from './settings';
import { cloneSettings, copyInto, CURSOR_MODES } from './settings';

/** Degrees, for an angle the simulation keeps in radians. */
const DEGREES = (value: number): string => `${((value * 180) / Math.PI).toFixed(0)}°`;

export interface PanelHooks {
  /**
   * The settings changed. Fires on every step of a drag, so the flock reacts
   * while you drag it. `committed` is true only on the last change of an
   * interaction, which is when a set is worth storing.
   */
  apply(committed: boolean): void;
  /** Centres on the flock and frames it, without turning follow on. */
  frameFlock(): void;
  /** Re-seeds the flock, which is the only thing `spawnRadius` can affect. */
  restart(): void;
  /** Prints the set to the console, in a shape that survives being pasted. */
  exportSettings(): void;
  /** Clears the stored set and puts every value back to its default. */
  reset(): void;
}

export interface PanelOptions {
  container: HTMLElement;
  /** Bound to, and mutated in place. */
  settings: Settings;
  /** Upper bound on the count slider. */
  capacity: number;
  hooks: PanelHooks;
}

export interface Panel {
  /**
   * True when something in the panel has the keyboard. No global key takes a
   * modifier beyond shift, so typing into a field would otherwise also drive
   * the app.
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

function presetOptions(presets: readonly { readonly name: string }[]): Record<string, string> {
  return listOf(presets.map((preset) => preset.name));
}

// Slider ranges span what the presets in `sim/presets.ts` use, with room on
// either side to leave them. A range wide enough to hold every value the
// simulation survives is mostly dead zone, and a slider that does nothing for
// most of its travel makes the flock feel broken when it is not.
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
    max: 60,
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
  flockFolder.addBinding(flock, 'maxForce', { label: 'max force', min: 0, max: 320, step: 1 });
  // The top of this one is 0.05 rather than 0.2: past it the pull overpowers
  // the rules and the flock is a ball on a string.
  flockFolder.addBinding(flock, 'originPull', {
    label: 'origin pull',
    min: 0,
    max: 0.05,
    step: 0.0005,
    format: (value: number) => value.toFixed(4),
  });
  flockFolder.addBinding(flock, 'minSpeed', { label: 'min speed', min: 0, max: 120, step: 1 });
  flockFolder.addBinding(flock, 'maxSpeed', { label: 'max speed', min: 0, max: 180, step: 1 });
  flockFolder.addBinding(flock, 'maxTurnRate', {
    label: 'turn rate',
    min: 0,
    max: Math.PI * 3,
    step: 0.01,
    format: (value: number) => `${DEGREES(value)}/s`,
  });
  flockFolder.addBinding(flock, 'wanderStrength', { label: 'wander', min: 0, max: 30, step: 0.1 });
  flockFolder.addBinding(flock, 'wanderRate', { label: 'wander rate', min: 0, max: 8, step: 0.1 });

  flockFolder.addBinding(flock, 'spawnRadius', { label: 'spawn r', min: 10, max: 2000, step: 10 });
  flockFolder.addButton({ title: 'restart' }).on('click', () => {
    hooks.restart();
  });

  const cursorFolder = pane.addFolder({ title: 'cursor', expanded: true });
  // A dropdown because Tweakpane has no radio control without a plugin.
  cursorFolder.addBinding(cursor, 'mode', { options: listOf(CURSOR_MODES) });
  cursorFolder.addBinding(cursor, 'strength', { min: 0, max: 2000, step: 10 });
  cursorFolder.addBinding(flock, 'cursorRadius', { label: 'radius', min: 0, max: 400, step: 5 });

  const cameraFolder = pane.addFolder({ title: 'camera', expanded: true });
  cameraFolder.addBinding(camera, 'follow');
  // With follow on the zoom is a fraction of the flock, and with it off a plain
  // scale. Tweakpane cannot relabel a binding, so both are here and one hides.
  const zoomBinding = cameraFolder.addBinding(camera, 'logScale', {
    label: 'zoom',
    min: MIN_LOG_SCALE,
    max: MAX_LOG_SCALE,
    format: (value: number) => formatScale(10 ** value),
  });
  const followBindings = [
    cameraFolder.addBinding(camera, 'frameLog', {
      label: 'frame',
      min: MIN_FRAME_LOG,
      max: MAX_FRAME_LOG,
      step: 0.01,
      format: formatFramePercent,
    }),
    cameraFolder.addBinding(camera, 'zoomTolerance', {
      label: 'zoom hold',
      min: 0,
      max: MAX_ZOOM_TOLERANCE,
      step: 0.005,
      format: (value: number) => `${value.toFixed(3)} dec`,
    }),
    cameraFolder.addBinding(camera, 'zoomTau', {
      label: 'zoom ease',
      min: 0,
      max: MAX_ZOOM_TAU,
      step: 0.05,
      format: (value: number) => `${value.toFixed(2)} s`,
    }),
  ];
  cameraFolder.addButton({ title: 'frame flock' }).on('click', () => {
    hooks.frameFlock();
  });

  const showCameraMode = (): void => {
    zoomBinding.hidden = camera.follow;
    for (const binding of followBindings) binding.hidden = !camera.follow;
  };
  showCameraMode();

  const lookFolder = pane.addFolder({ title: 'look', expanded: false });
  lookFolder.addBinding(look, 'boid', { label: 'palette', options: presetOptions(BOID_PRESETS) });
  lookFolder.addBinding(look, 'trails');
  lookFolder.addBinding(look, 'blend', { options: { additive: 'additive', alpha: 'alpha' } });
  lookFolder.addBinding(look, 'floorFade', { label: 'floor fade', min: 0, max: 2, step: 1 });
  lookFolder.addBinding(look, 'grid', { options: presetOptions(GRID_PRESETS) });
  lookFolder.addBinding(look, 'snapLines', { label: 'snap lines' });
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
    showCameraMode();
    hooks.apply(event.last);
  });

  const refresh = (): void => {
    // Tweakpane's refresh rounds each value to its slider's step and writes the
    // rounded number back to the object it is bound to. A preset that sets a
    // field of view of 2π/3 would land in the settings as 2.09, which is a set
    // that matches no preset. Putting the set back afterwards keeps the
    // rounding in the widget, where it is a display grain and nothing more.
    const before = cloneSettings(settings);
    pane.refresh();
    copyInto(settings, before);
    showCameraMode();
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
