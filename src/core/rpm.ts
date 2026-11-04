/** Highest value the 2-byte RPM field can encode: (255 * 256 + 255) / 4. */
export const MAX_RPM = 16383.75;

// Mode 01 response (41) for PID 0C, then the two data bytes A and B as 4 hex digits.
const RPM_PATTERN = /410C([0-9A-F]{2})([0-9A-F]{2})/;

/**
 * Extract engine RPM from the answer lines of a `010C` request.
 *
 * Works with and without spaces (`41 0C 1A F8` / `410C1AF8`), with headers on, and when
 * several ECUs answer (the first valid one wins). Returns null if no valid RPM is found.
 */
export function parseRpm(lines: readonly string[]): number | null {
  for (const line of lines) {
    const compact = line.replace(/\s+/g, '').toUpperCase();
    if (compact === '' || compact === 'SEARCHING...') continue;

    const match = RPM_PATTERN.exec(compact);
    if (!match) continue;

    const a = parseInt(match[1], 16);
    const b = parseInt(match[2], 16);
    const rpm = (a * 256 + b) / 4;
    if (rpm >= 0 && rpm <= MAX_RPM) return rpm;
  }
  return null;
}
