/**
 * Where a settings blob is kept between visits.
 *
 * An interface rather than a call to `localStorage`, for two reasons. The
 * smaller one is that the tests run in node with no DOM — `vite.config.ts` sets
 * `environment: 'node'` — so anything that reached for a browser global could
 * not be tested at all. The larger one is that `localStorage` throws rather
 * than failing quietly: Safari's private mode, a browser configured to block
 * site data, and a page opened from `file://` all raise on access, not on
 * write. A flocking simulator that refused to start because it could not
 * remember a slider would be a bad trade, so every path here degrades to
 * running without persistence.
 */

export interface SettingsStorage {
  /** The stored blob, or null when there is none and when reading failed. */
  read(): string | null;
  write(text: string): void;
  clear(): void;
}

/** What `localStorage` calls the settings. */
export const SETTINGS_KEY = 'web-flock.settings';

/** Keeps nothing. What the app falls back to when a store is unusable. */
export const NO_STORAGE: SettingsStorage = {
  read: () => null,
  write: () => {},
  clear: () => {},
};

/**
 * The browser's store, or {@link NO_STORAGE} if it cannot be reached.
 *
 * The probe is a real write and delete rather than a feature test, because
 * `window.localStorage` exists and then throws in exactly the cases that
 * matter.
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
        // Full, or turned off since the probe. Nothing to do and nothing worth
        // interrupting the user for: the app runs, it just forgets.
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

/** Keeps a blob in memory. For tests, and for a browser that refuses to. */
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
