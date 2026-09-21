import type { BoidStyle } from '../render/boid-style';
import { BOID_PRESETS } from '../render/boid-style';
import type { GridStyle } from '../render/grid-style';
import { GRID_PRESETS } from '../render/grid-style';
import type { Settings } from '../ui/settings';
import { applyLook } from '../ui/settings';
import type { PresetSelection, QuadrantView } from './compare';
import { createPresetSelection } from './compare';

/**
 * The keys the panel cannot replace: comparison mode over the presets, and
 * frame-time readings.
 *
 * The digits drive one preset list at a time and `b` says which, grid or boid,
 * because they are the same nine keys.
 */

export interface StyleKeyHooks {
  /** A digit changed the selection in the settings; the panel must catch up. */
  changed(): void;
  /** Records the HUD as it stands and prints every reading so far. */
  dumpReadings(): void;
  clearReadings(): void;
}

export interface StyleKeys {
  /** Four panes of grid presets, reading order; null unless comparing them. */
  readonly gridQuadrants: readonly QuadrantView<Readonly<GridStyle>>[] | null;
  /** Four panes of boid presets, reading order; null unless comparing them. */
  readonly boidQuadrants: readonly QuadrantView<Readonly<BoidStyle>>[] | null;
  readonly help: string;
  dispose(): void;
}

export function createStyleKeys(
  settings: Settings,
  hooks: StyleKeyHooks,
  /** False while the panel has the keyboard. */
  active: () => boolean,
): StyleKeys {
  const gridPresets: PresetSelection<Readonly<GridStyle>> = createPresetSelection(GRID_PRESETS, {
    get: () => settings.look.grid,
    set: (name) => {
      settings.look.grid = name;
      hooks.changed();
    },
  });

  const boidPresets: PresetSelection<Readonly<BoidStyle>> = createPresetSelection(BOID_PRESETS, {
    get: () => settings.look.boid,
    set: (name) => {
      settings.look.boid = name;
      hooks.changed();
    },
  });

  /** True when the digits drive the boid list rather than the grid's. */
  let onBoids = false;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey || !active()) return;

    switch (event.key) {
      case 'b':
        onBoids = !onBoids;
        break;
      case 'p':
        hooks.dumpReadings();
        break;
      case 'P':
        hooks.clearReadings();
        break;
      default:
        if (!(onBoids ? boidPresets : gridPresets).handleKey(event.key)) return;
    }
    event.preventDefault();
  };

  window.addEventListener('keydown', onKeyDown);

  return {
    get gridQuadrants() {
      return onBoids ? null : gridPresets.quadrants;
    },

    get boidQuadrants() {
      if (!onBoids) return null;
      // The panel's trail, blend and fade overrides go on every pane, so the
      // panes differ in the preset and nothing else.
      return (
        boidPresets.quadrants?.map((pane) => ({
          ...pane,
          style: applyLook(pane.style, settings.look),
        })) ?? null
      );
    },

    get help() {
      const list = onBoids ? boidPresets : gridPresets;
      return `${onBoids ? 'boid' : 'grid'} ${list.help} · b ${onBoids ? 'grid' : 'boid'} · p log`;
    },

    dispose(): void {
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
