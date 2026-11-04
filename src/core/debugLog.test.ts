import { describe, expect, it } from 'vitest';

import { DebugLog, showControlChars } from './debugLog';

function fakeClock() {
  let t = 0;
  return () => ++t;
}

describe('DebugLog', () => {
  it('stores entries oldest first with timestamps', () => {
    const log = new DebugLog(10, fakeClock());
    log.add('tx', '010C');
    log.add('rx', '410C1AF8');
    expect(log.entries()).toEqual([
      { t: 1, dir: 'tx', text: '010C' },
      { t: 2, dir: 'rx', text: '410C1AF8' },
    ]);
  });

  it('drops the oldest entries past capacity', () => {
    const log = new DebugLog(3, fakeClock());
    for (const text of ['a', 'b', 'c', 'd', 'e']) log.add('info', text);
    expect(log.entries().map((e) => e.text)).toEqual(['c', 'd', 'e']);
  });

  it('returns a copy that callers cannot mutate', () => {
    const log = new DebugLog();
    log.add('info', 'x');
    log.entries().pop();
    expect(log.entries()).toHaveLength(1);
  });

  it('notifies subscribers until they unsubscribe', () => {
    const log = new DebugLog(10, fakeClock());
    const seen: string[] = [];
    const unsubscribe = log.subscribe((entry) => seen.push(entry.text));
    log.add('tx', 'ATZ');
    unsubscribe();
    log.add('tx', 'ATE0');
    expect(seen).toEqual(['ATZ']);
  });

  it('clears entries', () => {
    const log = new DebugLog();
    log.add('info', 'x');
    log.clear();
    expect(log.entries()).toEqual([]);
  });
});

describe('showControlChars', () => {
  it('makes CR and LF visible', () => {
    expect(showControlChars('OK\r\n>')).toBe('OK⏎␊>');
  });
});
