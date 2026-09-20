import type { BoidStyle } from '../render/boid-style';
import { BOID_PRESETS } from '../render/boid-style';
import type { GridStyle } from '../render/grid-style';
import { GRID_PRESETS } from '../render/grid-style';
import type { Settings } from '../ui/settings';
import { applyLook } from '../ui/settings';
import type { PresetSelection, QuadrantView } from './compare';
import { createPresetSelection } from './compare';

/**
 * What survives step 5 of the keyboard.
 *
 * The panel took everything that is a *value* — counts, radii, weights, which
 * preset, what the cursor does. What is left is the two things a panel cannot
 * do, and both are asked for again later in PLAN.md:
 *
 * - **Comparison mode** (`c`, `[`, `]`, digits), four presets in one frame.
 *   Step 3 built it, 4a reused it, 7a and 7b both want it.
 * - **Readings** (`p`, `P`), which is how a number leaves this machine: Claude
 *   has no browser, so the user is the instrument for every performance
 *   question and `dev/readings.ts` is the shape the answer travels in.
 *
 * The digits drive one list at a time and `b` says which — grid or boid. They
 * are the same nine keys and there is nothing sensible for them to do to both
 * at once.
 *
 * **Deleted when the taste calls are settled, in 7b.** Nothing outside `dev/`
 * may import from it.
 */

export interface StyleKeyHooks {
  /** A digit changed the selection in the settings; the panel must catch up. */
  changed(): void;
  /** Records the HUD as it stands and prints every reading so far. */
  dumpReadings(): void;
  /** Starts a fresh table of readings. */
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
  /** Whether the keys are ours — false while the panel has the keyboard. */
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
      // The panel's trail, blend and fade overrides ride on top of every pane,
      // so a comparison shows the presets differing in what they actually
      // differ in rather than in what the panel has since changed.
      if (!onBoids) return null;
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
