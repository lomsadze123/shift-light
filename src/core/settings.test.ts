import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, parseSettings, sanitizeSettings } from './settings';

describe('sanitizeSettings', () => {
  it('keeps valid values', () => {
    const settings = {
      thresholdRpm: 6200,
      leadMs: 180,
      hysteresisRpm: 250,
      tcpHost: '192.168.88.156',
      tcpPort: 35001,
    };
    expect(sanitizeSettings(settings)).toEqual(settings);
  });

  it('upgrades settings saved before the TCP fields existed', () => {
    expect(sanitizeSettings({ thresholdRpm: 6000, leadMs: 150, hysteresisRpm: 200 })).toEqual({
      ...DEFAULT_SETTINGS,
      thresholdRpm: 6000,
    });
  });

  it.each(['192.168.1.20', 'macbook.local', '::1', 'fe80::1'])('accepts host %j', (tcpHost) => {
    expect(sanitizeSettings({ tcpHost }).tcpHost).toBe(tcpHost);
  });

  it('trims the host', () => {
    expect(sanitizeSettings({ tcpHost: '  10.0.0.2 ' }).tcpHost).toBe('10.0.0.2');
  });

  it.each(['', 'http://10.0.0.2', '10.0.0.2 ; rm', 'a b', 42])('rejects host %j', (tcpHost) => {
    expect(sanitizeSettings({ tcpHost }).tcpHost).toBe('');
  });

  it('clamps the port', () => {
    expect(sanitizeSettings({ tcpPort: 0 }).tcpPort).toBe(1);
    expect(sanitizeSettings({ tcpPort: 70000 }).tcpPort).toBe(65535);
    expect(sanitizeSettings({ tcpPort: 35000.4 }).tcpPort).toBe(35000);
  });

  it('fills missing values with defaults', () => {
    expect(sanitizeSettings({ thresholdRpm: 6000 })).toEqual({
      ...DEFAULT_SETTINGS,
      thresholdRpm: 6000,
    });
  });

  it('clamps out-of-range values', () => {
    expect(sanitizeSettings({ thresholdRpm: 50_000, leadMs: -20, hysteresisRpm: 0 })).toMatchObject(
      {
        thresholdRpm: 9000,
        leadMs: 0,
        hysteresisRpm: 50,
      },
    );
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
