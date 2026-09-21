/** Picking a style by eye: number keys for presets, `c` for four at once. */

const QUADRANTS = 4;

/** The settings own the selection, so this reads and writes it there. */
export interface PresetBinding {
  /** Name of the selected preset. An unknown name selects the first. */
  get(): string;
  set(name: string): void;
}

export interface QuadrantView<TStyle> {
  readonly style: TStyle;
  /**
   * What the overlay prints in the corner. It leads with the preset's own
   * number, which is also the key that selects it.
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
        binding.set(presets[at].name);
        comparing = false;
        return true;
      }

      switch (key) {
        case 'c':
          comparing = !comparing;
          if (comparing) from = selected();
          return true;
        // The window slides one preset at a time, so any four neighbours can be
        // seen together.
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
