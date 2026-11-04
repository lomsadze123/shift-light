/** User settings that are saved on the phone. */
export interface Settings {
  thresholdRpm: number;
  leadMs: number;
  hysteresisRpm: number;
  /** ELM327 emulator address for the TCP connection (development). Empty = not set. */
  tcpHost: string;
  tcpPort: number;
}

export const DEFAULT_SETTINGS: Settings = {
  thresholdRpm: 5500,
  leadMs: 150,
  hysteresisRpm: 200,
  tcpHost: '',
  tcpPort: 35000,
};

type NumericSetting = 'thresholdRpm' | 'leadMs' | 'hysteresisRpm' | 'tcpPort';

/** Allowed range and rounding step per numeric setting. */
export const SETTING_LIMITS: Record<NumericSetting, { min: number; max: number; step: number }> = {
  thresholdRpm: { min: 1000, max: 9000, step: 50 },
  leadMs: { min: 0, max: 500, step: 10 },
  hysteresisRpm: { min: 50, max: 1000, step: 50 },
  tcpPort: { min: 1, max: 65535, step: 1 },
};

// IPv4, IPv6 or a host name: letters, digits, dots, colons and dashes only.
const HOST_PATTERN = /^[A-Za-z0-9.:-]{1,253}$/;

function cleanNumber(key: NumericSetting, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SETTINGS[key];
  const { min, max, step } = SETTING_LIMITS[key];
  const rounded = Math.round(value / step) * step;
  return Math.min(Math.max(rounded, min), max);
}

function cleanHost(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SETTINGS.tcpHost;
  const host = value.trim();
  return HOST_PATTERN.test(host) ? host : DEFAULT_SETTINGS.tcpHost;
}

/**
 * Turn anything (parsed JSON from storage, possibly old, corrupt or hand-edited) into valid
 * settings: missing or invalid values fall back to defaults, the rest is clamped and rounded.
 */
export function sanitizeSettings(input: unknown): Settings {
  const source =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  return {
    thresholdRpm: cleanNumber('thresholdRpm', source.thresholdRpm),
    leadMs: cleanNumber('leadMs', source.leadMs),
    hysteresisRpm: cleanNumber('hysteresisRpm', source.hysteresisRpm),
    tcpHost: cleanHost(source.tcpHost),
    tcpPort: cleanNumber('tcpPort', source.tcpPort),
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
