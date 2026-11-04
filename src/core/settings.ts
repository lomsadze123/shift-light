/** User settings that are saved on the phone. */
export interface Settings {
  thresholdRpm: number;
  leadMs: number;
  hysteresisRpm: number;
}

export const DEFAULT_SETTINGS: Settings = {
  thresholdRpm: 5500,
  leadMs: 150,
  hysteresisRpm: 200,
};

/** Allowed range and rounding step per setting. */
export const SETTING_LIMITS: Record<keyof Settings, { min: number; max: number; step: number }> = {
  thresholdRpm: { min: 1000, max: 9000, step: 50 },
  leadMs: { min: 0, max: 500, step: 10 },
  hysteresisRpm: { min: 50, max: 1000, step: 50 },
};

function clean(key: keyof Settings, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SETTINGS[key];
  const { min, max, step } = SETTING_LIMITS[key];
  const rounded = Math.round(value / step) * step;
  return Math.min(Math.max(rounded, min), max);
}

/**
 * Turn anything (parsed JSON from storage, possibly old, corrupt or hand-edited) into valid
 * settings: missing or invalid values fall back to defaults, the rest is clamped and rounded.
 */
export function sanitizeSettings(input: unknown): Settings {
  const source =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  return {
    thresholdRpm: clean('thresholdRpm', source.thresholdRpm),
    leadMs: clean('leadMs', source.leadMs),
    hysteresisRpm: clean('hysteresisRpm', source.hysteresisRpm),
  };
}

/** Parse the stored JSON string. Never throws. */
export function parseSettings(json: string | null): Settings {
  if (json === null) return { ...DEFAULT_SETTINGS };
  try {
    return sanitizeSettings(JSON.parse(json));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
