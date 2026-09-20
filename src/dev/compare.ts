/**
 * Picking a style by eye: number keys for presets, `c` for four at once.
 *
 * PLAN.md asks for comparison mode in step 3 and says it pays for itself again
 * in 4a and 7a. It does, and the machinery around it is identical every time —
 * which list, which one is selected, which four are on screen — so it lives
 * here rather than being written out once per subsystem.
 *
 * **Deleted with the rest of `dev/` once the taste calls are settled.**
 */

const QUADRANTS = 4;

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
  /** The style to draw an ordinary frame with. */
  readonly style: TStyle;
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
): PresetSelection<TStyle> {
  let index = 0;
  let comparing = false;
  /** Index of the first of the four presets on screen while comparing. */
  let from = 0;

  return {
    get style() {
      return presets[index];
    },

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
        index = at;
        comparing = false;
        return true;
      }

      switch (key) {
        case 'c':
          comparing = !comparing;
          if (comparing) from = index;
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
