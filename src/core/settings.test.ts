import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, parseSettings, sanitizeSettings } from './settings';

describe('sanitizeSettings', () => {
  it('keeps valid values', () => {
    const settings = { thresholdRpm: 6200, leadMs: 180, hysteresisRpm: 250 };
    expect(sanitizeSettings(settings)).toEqual(settings);
  });

  it('fills missing values with defaults', () => {
    expect(sanitizeSettings({ thresholdRpm: 6000 })).toEqual({
      ...DEFAULT_SETTINGS,
      thresholdRpm: 6000,
    });
  });

  it('clamps out-of-range values', () => {
    expect(sanitizeSettings({ thresholdRpm: 50_000, leadMs: -20, hysteresisRpm: 0 })).toEqual({
      thresholdRpm: 9000,
      leadMs: 0,
      hysteresisRpm: 50,
    });
  });

  it('rounds to the setting step', () => {
    expect(sanitizeSettings({ thresholdRpm: 5537, leadMs: 154 })).toMatchObject({
      thresholdRpm: 5550,
      leadMs: 150,
    });
  });

  it.each([null, undefined, 'x', 42, [], { thresholdRpm: 'fast' }, { leadMs: NaN }])(
    'falls back to defaults for %j',
    (input) => {
      const result = sanitizeSettings(input);
      expect(Number.isFinite(result.thresholdRpm)).toBe(true);
      expect(result.leadMs).toBe(DEFAULT_SETTINGS.leadMs);
    },
  );
});

describe('parseSettings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults for corrupt JSON', () => {
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
  });

  it('parses stored settings', () => {
    expect(parseSettings('{"thresholdRpm":6100}').thresholdRpm).toBe(6100);
  });

  it('returns a copy, not the shared defaults object', () => {
    const settings = parseSettings(null);
    settings.thresholdRpm = 1;
    expect(DEFAULT_SETTINGS.thresholdRpm).toBe(5500);
  });
});
