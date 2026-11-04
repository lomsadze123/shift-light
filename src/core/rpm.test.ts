import { describe, expect, it } from 'vitest';

import { MAX_RPM, parseRpm } from './rpm';

describe('parseRpm', () => {
  it('decodes the PLAN.md example without spaces', () => {
    // A = 0x1A = 26, B = 0xF8 = 248 → (26 * 256 + 248) / 4 = 1726
    expect(parseRpm(['410C1AF8'])).toBe(1726);
  });

  it('decodes with spaces', () => {
    expect(parseRpm(['41 0C 1A F8'])).toBe(1726);
  });

  it('accepts lowercase hex', () => {
    expect(parseRpm(['410c1af8'])).toBe(1726);
  });

  it('decodes the emulator answer (620 RPM idle)', () => {
    expect(parseRpm(['410C09B0'])).toBe(620);
  });

  it('keeps quarter-RPM precision', () => {
    expect(parseRpm(['410C0001'])).toBe(0.25);
  });

  it('skips a SEARCHING... line', () => {
    expect(parseRpm(['SEARCHING...', '410C1AF8'])).toBe(1726);
  });

  it('handles SEARCHING... glued to the answer', () => {
    expect(parseRpm(['SEARCHING...410C1AF8'])).toBe(1726);
  });

  it('takes the first ECU when several answer', () => {
    expect(parseRpm(['410C1AF8', '410C09B0'])).toBe(1726);
  });

  it('skips lines without RPM before the answer', () => {
    expect(parseRpm(['', '  ', 'OK', '41 0C 09 B0'])).toBe(620);
  });

  it('finds the answer when headers are on', () => {
    expect(parseRpm(['7E8 04 41 0C 1A F8'])).toBe(1726);
  });

  it('returns null for NO DATA', () => {
    expect(parseRpm(['NO DATA'])).toBeNull();
  });

  it('returns null for an empty answer', () => {
    expect(parseRpm([])).toBeNull();
  });

  it.each([['?'], ['410C1A'], ['410CZZZZ'], ['410D1AF8'], ['STOPPED'], ['41 0C 1A']])(
    'returns null for garbage %j',
    (line) => {
      expect(parseRpm([line])).toBeNull();
    },
  );

  it('decodes boundary values', () => {
    expect(parseRpm(['410C0000'])).toBe(0);
    expect(parseRpm(['410CFFFF'])).toBe(MAX_RPM);
    expect(MAX_RPM).toBe(16383.75);
  });
});
