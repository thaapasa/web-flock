/**
 * Picking a style by eye: number keys for presets, `c` for four at once.
 *
 * PLAN.md asks for comparison mode in step 3 and says it pays for itself again
 * in 4a and 7a. It does, and the machinery around it is identical every time —
 * which list, which one is selected, which four are on screen — so it lives
 * here rather than being written out once per subsystem.
 *
 * **The selection is not kept here.** Step 5 put every preset in the panel, so
 * the settings own which one is current and this reads and writes them through
 * a {@link PresetBinding}. Two places remembering a selection would be two
 * places to disagree, and the one that lost would be whichever the user had
 * just touched.
 *
 * **Deleted with the rest of `dev/` once the taste calls are settled** — which
 * is 7b, not now: 7a revisits the boid presets against a tuned flock and 7b
 * revisits all of them against the finished renderer.
 */

const QUADRANTS = 4;

/** Where the current selection actually lives. See the file comment. */
export interface PresetBinding {
  /** Name of the selected preset. An unknown name selects the first. */
  get(): string;
  set(name: string): void;
}

/** One pane of comparison mode. */
export interface QuadrantView<TStyle> {
  readonly style: TStyle;
  /**
   * What the overlay prints in the corner. It leads with the preset's own
   * number, which is also the key that selects it — the quadrant's position on
   * screen is never a number, because two numberings for four panes is one too
   * many.
   */
  readonly caption: string;
}

export interface PresetSelection<TStyle> {
  /** Four panes in reading order while comparing; null otherwise. */
  readonly quadrants: readonly QuadrantView<TStyle>[] | null;
  readonly comparing: boolean;
  /** One line of key bindings, for the overlay. */
  readonly help: string;
  /** Takes the key if it is one of ours, and says whether it did. */
  handleKey(key: string): boolean;
}

export function createPresetSelection<TStyle extends { readonly name: string }>(
  presets: readonly TStyle[],
  binding: PresetBinding,
): PresetSelection<TStyle> {
  let comparing = false;
  /** Index of the first of the four presets on screen while comparing. */
  let from = 0;

  const selected = (): number => {
    const at = presets.findIndex((preset) => preset.name === binding.get());
    return at < 0 ? 0 : at;
  };

  return {
    get comparing() {
      return comparing;
    },

    get quadrants() {
      if (!comparing) return null;
      return Array.from({ length: QUADRANTS }, (_, i) => {
        const at = (from + i) % presets.length;
        return { style: presets[at], caption: `${at + 1}  ${presets[at].name}` };
      });
    },

    get help() {
      return comparing
        ? `[ ] slide through all ${presets.length} · number picks · c exit compare`
        : `1-${presets.length} presets · c compare`;
    },

    handleKey(key): boolean {
      if (key >= '1' && key <= '9') {
        const at = Number(key) - 1;
        if (at >= presets.length) return false;
        // A digit means the same thing in both modes: that preset, full screen.
        // While comparing, the captions carry these same numbers, so a look
        // turns into a choice without leaving the mode first.
        binding.set(presets[at].name);
        comparing = false;
        return true;
      }

      switch (key) {
        case 'c':
          comparing = !comparing;
          if (comparing) from = selected();
          return true;
        // One preset at a time, not four: the window slides through the list so
        // any four neighbours can be seen together, rather than dealing the
        // presets into fixed pages that can never be compared across.
        case '[':
          from = (from - 1 + presets.length) % presets.length;
          return true;
        case ']':
          from = (from + 1) % presets.length;
          return true;
        default:
          return false;
      }
    },
  };
}
