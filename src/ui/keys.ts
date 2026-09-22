import { BOID_PRESETS } from '../render/boid-style';
import { FLOCK_PRESETS } from '../sim/presets';
import type { Settings } from './settings';
import { applyFlockPreset } from './settings';

/**
 * The number keys: a digit picks how the flock flies, shift and a digit picks
 * the palette. Plus the frame-time log, which is the one binding here that
 * goes when `src/dev` does.
 *
 * Read from `event.code`, not `event.key`: shift and a digit is a punctuation
 * mark, and which one depends on the keyboard layout.
 */

const DIGIT = /^Digit([1-9])$/;

export interface AppKeyHooks {
  /** A preset wrote to the settings; the panel and storage have to catch up. */
  changed(): void;
  /** Records the HUD as it stands and prints every reading so far. */
  dumpReadings(): void;
  clearReadings(): void;
}

export interface AppKeys {
  /** One line of key bindings, for the overlay. */
  readonly help: string;
  dispose(): void;
}

export function createAppKeys(
  settings: Settings,
  hooks: AppKeyHooks,
  /** False while the panel has the keyboard. */
  active: () => boolean,
): AppKeys {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey || !active()) return;

    const digit = DIGIT.exec(event.code);
    if (digit) {
      const at = Number(digit[1]) - 1;
      if (event.shiftKey) {
        if (at >= BOID_PRESETS.length) return;
        settings.look.boid = BOID_PRESETS[at].name;
      } else {
        if (at >= FLOCK_PRESETS.length) return;
        applyFlockPreset(settings.flock, FLOCK_PRESETS[at]);
      }
      hooks.changed();
    } else if (event.key === 'p') {
      hooks.dumpReadings();
    } else if (event.key === 'P') {
      hooks.clearReadings();
    } else {
      return;
    }

    event.preventDefault();
  };

  window.addEventListener('keydown', onKeyDown);

  return {
    help: `1-${FLOCK_PRESETS.length} flock · shift 1-${BOID_PRESETS.length} palette · p log`,

    dispose(): void {
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
