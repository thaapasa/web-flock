/**
 * Where a settings blob is kept between visits.
 *
 * `localStorage` throws rather than failing quietly: Safari's private mode, a
 * browser that blocks site data and a page opened from `file://` all raise on
 * access. Every path here falls back to running without persistence.
 */

export interface SettingsStorage {
  /** The blob, or null when there is none and when reading fails. */
  read(): string | null;
  write(text: string): void;
  clear(): void;
}

export const SETTINGS_KEY = 'web-flock.settings';

export const NO_STORAGE: SettingsStorage = {
  read: () => null,
  write: () => {},
  clear: () => {},
};

/**
 * The probe writes and deletes for real rather than testing for the feature,
 * because `window.localStorage` exists and then throws in the cases that matter.
 */
export function createLocalStorage(key: string = SETTINGS_KEY): SettingsStorage {
  let store: Storage;
  try {
    store = window.localStorage;
    const probe = `${key}.probe`;
    store.setItem(probe, '1');
    store.removeItem(probe);
  } catch {
    return NO_STORAGE;
  }

  return {
    read(): string | null {
      try {
        return store.getItem(key);
      } catch {
        return null;
      }
    },

    write(text: string): void {
      try {
        store.setItem(key, text);
      } catch {
        // Full, or turned off since the probe. The app runs, it just forgets.
      }
    },

    clear(): void {
      try {
        store.removeItem(key);
      } catch {
        // As above.
      }
    },
  };
}

export function createMemoryStorage(initial: string | null = null): SettingsStorage {
  let text = initial;
  return {
    read: () => text,
    write: (next: string) => {
      text = next;
    },
    clear: () => {
      text = null;
    },
  };
}
