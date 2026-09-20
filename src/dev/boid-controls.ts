import type { Camera } from '../camera/camera';
import type { BoidStyle } from '../render/boid-style';
import { BOID_PRESETS } from '../render/boid-style';
import type { PresetSelection, QuadrantView } from './compare';
import { createPresetSelection } from './compare';
import { DESIGN_LOG_SCALE, DESIGN_SPECIMENS } from './pose-track';

/**
 * Scaffolding for step 4a, and only for step 4a.
 *
 * Two independent toggles, which is one more than it first looks like it
 * needs:
 *
 * - **`d` swaps the scene**: the design harness, or the flock. What is being
 *   flown.
 * - **`b` swaps the focus**: whether the number keys and `c` drive boid styles
 *   or grid styles. Which list the keyboard is pointed at.
 *
 * Keeping them apart is what lets a boid style be judged over a real crowd,
 * which is the whole of 4b and most of 7a — a single key that did both would
 * make the mark adjustable only against six synthetic specimens. Entering the
 * harness turns the focus on as a convenience, because that is always what was
 * meant; leaving it does not turn it off.
 *
 * **This whole file is deleted in step 5.** Nothing outside `dev/` may import
 * from it.
 */

export interface BoidControls {
  /** True when the number keys and `c` belong to the boids, not the grid. */
  readonly focused: boolean;
  /** True when the design harness is flying instead of the flock. */
  readonly designing: boolean;
  readonly style: Readonly<BoidStyle>;
  readonly quadrants: readonly QuadrantView<Readonly<BoidStyle>>[] | null;
  /** Replaces the help line while the boids own the number keys. */
  readonly help: string;
  /** Appended to the grid's help line while the grid owns them. */
  readonly hint: string;
  dispose(): void;
}

export function createBoidControls(camera: Camera): BoidControls {
  const selection: PresetSelection<Readonly<BoidStyle>> = createPresetSelection(BOID_PRESETS);

  let focused = false;
  let designing = false;
  let specimen = 0;

  /** Puts a specimen on screen, large enough to argue about. */
  const frameSpecimen = (index: number): void => {
    specimen = (index + DESIGN_SPECIMENS.length) % DESIGN_SPECIMENS.length;
    const { centre } = DESIGN_SPECIMENS[specimen];
    camera.setCenter(centre.x, centre.y);
    camera.logScale = DESIGN_LOG_SCALE;
  };

  /** What the help line says about which scene is flying. */
  const scene = (): string =>
    designing ? `, . ${DESIGN_SPECIMENS[specimen].name} · d flock` : 'd design boid';

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    switch (event.key) {
      case 'b':
        focused = !focused;
        break;
      case 'd':
        designing = !designing;
        if (designing) {
          focused = true;
          frameSpecimen(specimen);
        }
        break;
      case ',':
        if (!designing) return;
        frameSpecimen(specimen - 1);
        break;
      case '.':
        if (!designing) return;
        frameSpecimen(specimen + 1);
        break;
      default:
        if (!focused || !selection.handleKey(event.key)) return;
    }
    event.preventDefault();
  };

  window.addEventListener('keydown', onKeyDown);

  return {
    get focused() {
      return focused;
    },

    get designing() {
      return designing;
    },

    get style() {
      return selection.style;
    },

    get quadrants() {
      // Only while the keyboard is pointed here: the grid's comparison mode and
      // this one both want the four panes, and two at once would fight over
      // which style each pane shows.
      return focused ? selection.quadrants : null;
    },

    get help() {
      return `wheel zoom · drag pan · ${selection.help} · ${scene()} · b grid keys`;
    },

    get hint() {
      return `b boid keys · ${scene()}`;
    },

    dispose(): void {
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
