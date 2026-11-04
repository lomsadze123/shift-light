import { describe, expect, it } from 'vitest';

import { Emitter } from './emitter';

type Events = { ping: number; name: string };

describe('Emitter', () => {
  it('delivers payloads to listeners of that event only', () => {
    const emitter = new Emitter<Events>();
    const pings: number[] = [];
    const names: string[] = [];
    emitter.on('ping', (n) => pings.push(n));
    emitter.on('name', (s) => names.push(s));

    emitter.emit('ping', 1);
    emitter.emit('name', 'a');
    emitter.emit('ping', 2);

    expect(pings).toEqual([1, 2]);
    expect(names).toEqual(['a']);
  });

  it('stops delivering after unsubscribe', () => {
    const emitter = new Emitter<Events>();
    const pings: number[] = [];
    const off = emitter.on('ping', (n) => pings.push(n));
    emitter.emit('ping', 1);
    off();
    emitter.emit('ping', 2);
    expect(pings).toEqual([1]);
  });

  it('lets a listener unsubscribe itself while emitting', () => {
    const emitter = new Emitter<Events>();
    const seen: string[] = [];
    const off = emitter.on('ping', () => {
      seen.push('first');
      off();
    });
    emitter.on('ping', () => seen.push('second'));
    emitter.emit('ping', 1);
    emitter.emit('ping', 2);
    expect(seen).toEqual(['first', 'second', 'second']);
  });

  it('clear() removes all listeners', () => {
    const emitter = new Emitter<Events>();
    const pings: number[] = [];
    emitter.on('ping', (n) => pings.push(n));
    emitter.clear();
    emitter.emit('ping', 1);
    expect(pings).toEqual([]);
  });
});
