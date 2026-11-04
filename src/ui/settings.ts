import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_SETTINGS, parseSettings, sanitizeSettings, type Settings } from '../core/settings';

const STORAGE_KEY = 'shift-light/settings/v1';

/**
 * Settings saved on the phone with AsyncStorage (a simple persistent key-value store).
 * `loaded` is false until the stored values are read, so the UI can wait for them.
 */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const current = useRef<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((json) => {
        if (cancelled) return;
        const stored = parseSettings(json);
        current.current = stored;
        setSettings(stored);
      })
      .catch(() => {
        // Unreadable storage: keep defaults rather than crash.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((changes: Partial<Settings>) => {
    const next = sanitizeSettings({ ...current.current, ...changes });
    current.current = next;
    setSettings(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {
      // A failed save only means the value is not remembered after a restart.
    });
  }, []);

  return { settings, loaded, update };
}
