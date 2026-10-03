import { BOID_PRESETS } from '../render/boid-style';
import { FLOCK_PRESETS } from '../sim/presets';
import type { Settings } from './settings';
import { applyFlockPreset, nextCursorMode } from './settings';

/**
 * The number keys: a digit picks how the flock flies, shift and a digit picks
 * the palette. The cursor keys: `c` cycles the cursor mode, and holding space
 * switches to the other force until it is let go. Plus the frame-time log,
 * which is the one binding here that goes when `src/dev` does.
 *
 * Read from `event.code`, not `event.key`: shift and a digit is a punctuation
 * mark, and which one depends on the keyboard layout.
 */

const DIGIT = /^Digit([1-9])$/;

export interface AppKeyHooks {
  /** A key wrote to the settings; the panel and storage have to catch up. */
  changed(): void;
  /** Space went down or up. Not a setting, so it is neither shown nor saved. */
  holdCursor(held: boolean): void;
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
  let held = false;

  const release = (): void => {
    if (!held) return;
    held = false;
    hooks.holdCursor(false);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey || !active()) return;

    if (event.code === 'Space') {
      // Also stops the page scrolling, on the repeats as well as the first press.
      event.preventDefault();
      if (held) return;
      held = true;
      hooks.holdCursor(true);
      return;
    }

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
    } else if (event.key === 'c') {
      settings.cursor.mode = nextCursorMode(settings.cursor.mode);
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

  // Not checked against `active`: if the panel takes the keyboard while space
  // is down, letting go still has to end the hold.
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') release();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  // No key-up arrives if the window loses focus while space is down.
  window.addEventListener('blur', release);

  return {
    help:
      `1-${FLOCK_PRESETS.length} flock · shift 1-${BOID_PRESETS.length} palette · ` +
      'c cursor · space hold · p log',

    dispose(): void {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
    },
  };
}
