import type { Camera } from '../camera/camera';
import type { BoidStyle } from '../render/boid-style';
import { BOID_PRESETS, DEFAULT_BOID_STYLE } from '../render/boid-style';
import type { PresetSelection, QuadrantView } from './compare';
import { createPresetSelection } from './compare';
import { DESIGN_LOG_SCALE, DESIGN_SPECIMENS } from './pose-track';

/**
 * Scaffolding for steps 4a and 4b, and only for those.
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
 * The rest belong to 4b and answer a question rather than choosing a look, so
 * they are live whichever list has the keyboard: `n`/`m` walk the count,
 * `z` puts the flock on screen, `t` takes the trails away, and `p` writes the
 * HUD to the console in a shape that can be pasted back.
 *
 * **This whole file is deleted in step 5.** Nothing outside `dev/` may import
 * from it.
 */

/**
 * Boid counts `n` and `m` step through.
 *
 * PLAN.md puts a count control in 4b rather than in step 8, so that what the
 * frame time costs is visible the whole way through rather than measured at
 * the end. A ladder and not a slider because the question is which rung
 * breaks, and a rung you can return to exactly is worth more than a smooth
 * sweep you cannot repeat.
 */
const COUNT_LADDER = [250, 500, 1000, 2000, 3500, 5000] as const;

/**
 * Separation radii `j` and `k` step through, in world units.
 *
 * The lever 4b found: spreading the flock drops how many neighbours each boid
 * has, and the step's cost falls with the square of that. It is also the
 * spacing the mark is judged against — at 6 against a 5-unit boid they fly
 * almost nose to tail. One ladder answers both questions, which is why it is
 * here and not waiting for step 5's panel.
 */
const SEPARATION_LADDER = [4, 6, 8, 10, 12, 14, 18, 24] as const;

/** What the simulation's arrays have to be sized for. */
export const TOP_OF_LADDER = COUNT_LADDER[COUNT_LADDER.length - 1];

/** What `app.ts` has to do when a key asks for it. */
export interface BoidHooks {
  /** Applies a boid count, live, with no restart. */
  setCount(count: number): void;
  /** Applies a separation radius, live, with no restart. */
  setSeparation(radius: number): void;
  /** Points the camera at the flock. Nothing follows it until step 6. */
  frameFlock(): void;
  /** Records the HUD as it stands and prints every reading so far. */
  dumpReadings(): void;
  /** Starts a fresh table of readings. */
  clearReadings(): void;
}

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

export function createBoidControls(camera: Camera, hooks: BoidHooks): BoidControls {
  const selection: PresetSelection<Readonly<BoidStyle>> = createPresetSelection(BOID_PRESETS);

  let focused = false;
  let designing = false;
  let specimen = 0;
  let rung = COUNT_LADDER.indexOf(500);
  let trails = true;
  let alpha = false;
  /** Exponent on the dimming below the size floor; see BoidStyle.floorFade. */
  let fade = DEFAULT_BOID_STYLE.floorFade;
  let spacing = SEPARATION_LADDER.indexOf(6);

  /**
   * The style as the keys have it: the selected preset with whatever the
   * knobs are overriding on top.
   *
   * Cached rather than rebuilt each frame, because this is read once per pane
   * per frame and a fresh object each time would be garbage the renderer never
   * asked for.
   */
  const variants = new Map<string, Readonly<BoidStyle>>();
  const tuned = (style: Readonly<BoidStyle>): Readonly<BoidStyle> => {
    const blend = alpha ? 'alpha' : style.blend;
    const trail = trails ? style.trail : 'none';
    if (blend === style.blend && trail === style.trail && fade === style.floorFade) return style;

    const key = `${style.name}|${blend}|${trail}|${fade}`;
    let variant = variants.get(key);
    if (!variant) {
      variant = Object.freeze({ ...style, blend, trail, floorFade: fade } satisfies BoidStyle);
      variants.set(key, variant);
    }
    return variant;
  };

  /** Puts a specimen on screen, large enough to argue about. */
  const frameSpecimen = (index: number): void => {
    specimen = (index + DESIGN_SPECIMENS.length) % DESIGN_SPECIMENS.length;
    const { centre } = DESIGN_SPECIMENS[specimen];
    camera.setCenter(centre.x, centre.y);
    camera.logScale = DESIGN_LOG_SCALE;
  };

  const stepSpacing = (by: number): void => {
    spacing = Math.min(SEPARATION_LADDER.length - 1, Math.max(0, spacing + by));
    hooks.setSeparation(SEPARATION_LADDER[spacing]);
  };

  const stepCount = (by: number): void => {
    rung = Math.min(COUNT_LADDER.length - 1, Math.max(0, rung + by));
    hooks.setCount(COUNT_LADDER[rung]);
  };

  /** What the help line says about which scene is flying. */
  const scene = (): string =>
    designing ? `, . ${DESIGN_SPECIMENS[specimen].name} · d flock` : 'd design boid';

  /** The 4b keys, which answer a question rather than choosing a look. */
  const measuring = (): string =>
    `n/m ${COUNT_LADDER[rung]} · j/k sep ${SEPARATION_LADDER[spacing]} · a ${alpha ? 'alpha' : 'add'}` +
    ` · o fade ${fade} · t trail${trails ? '' : ' off'} · z frame · p log`;

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
      case 'n':
        stepCount(-1);
        break;
      case 'm':
        stepCount(1);
        break;
      case 'z':
        hooks.frameFlock();
        break;
      case 't':
        trails = !trails;
        break;
      case 'j':
        stepSpacing(-1);
        break;
      case 'k':
        stepSpacing(1);
        break;
      case 'a':
        alpha = !alpha;
        break;
      case 'o':
        // Off, with length, with area. See BoidStyle.floorFade.
        fade = fade >= 2 ? 0 : fade + 1;
        break;
      case 'p':
        hooks.dumpReadings();
        break;
      case 'P':
        hooks.clearReadings();
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
      return tuned(selection.style);
    },

    get quadrants() {
      // Only while the keyboard is pointed here: the grid's comparison mode and
      // this one both want the four panes, and two at once would fight over
      // which style each pane shows.
      if (!focused) return null;
      return selection.quadrants?.map((pane) => ({ ...pane, style: tuned(pane.style) })) ?? null;
    },

    get help() {
      return `wheel zoom · ${selection.help} · ${measuring()} · ${scene()} · b grid`;
    },

    get hint() {
      return `b boid keys · ${measuring()} · ${scene()}`;
    },

    dispose(): void {
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
