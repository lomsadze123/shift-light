import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DisconnectedError } from './elm327Errors';
import {
  type PollerState,
  type PollerStats,
  RpmPoller,
  type RpmReader,
  type RpmSample,
} from './rpmPoller';

type ReadOptions = Parameters<RpmReader['readRpm']>[0];

/**
 * Waits `queueDelayMs` (like the driver queue / drain), calls onSent, then answers after
 * `latencyMs`. Scripted results are used first, then `fallback`.
 */
class FakeReader implements RpmReader {
  readonly calls: NonNullable<ReadOptions>[] = [];
  readonly results: (number | null | Error)[] = [];
  queueDelayMs = 0;
  latencyMs = 100;
  fallback = 3000;

  readRpm(options?: ReadOptions): Promise<number | null> {
    this.calls.push(options ?? {});
    const result = this.results.length > 0 ? this.results.shift() : this.fallback;
    const latencyMs = this.latencyMs;
    return new Promise((resolve, reject) => {
      const send = () => {
        options?.onSent?.();
        setTimeout(() => {
          if (result instanceof Error) reject(result);
          else resolve(result ?? null);
        }, latencyMs);
      };
      if (this.queueDelayMs > 0) setTimeout(send, this.queueDelayMs);
      else send();
    });
  }
}

function setup(options?: ConstructorParameters<typeof RpmPoller>[1]) {
  const reader = new FakeReader();
  const poller = new RpmPoller(reader, options);
  const samples: RpmSample[] = [];
  const stats: PollerStats[] = [];
  const states: PollerState[] = [];
  const errors: Error[] = [];
  poller.on('sample', (s) => samples.push(s));
  poller.on('stats', (s) => stats.push(s));
  poller.on('state', (s) => states.push(s));
  poller.on('error', (e) => errors.push(e));
  return { reader, poller, samples, stats, states, errors };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RpmPoller', () => {
  it('requests back-to-back with no fixed interval', async () => {
    const { poller, reader, samples } = setup();
    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(samples).toHaveLength(10);
    expect(reader.calls).toHaveLength(11); // the 11th is in flight
    poller.stop();
  });

  it('timestamps each sample at the midpoint of its request', async () => {
    const { poller, samples } = setup();
    poller.start();
    await vi.advanceTimersByTimeAsync(250);
    expect(samples.map((s) => s.t)).toEqual([1_000_050, 1_000_150]);
    expect(samples[0].rpm).toBe(3000);
    poller.stop();
  });

  it('measures the round trip from when the request is really sent', async () => {
    const { poller, reader, samples } = setup();
    reader.queueDelayMs = 500; // e.g. the driver draining a late answer first
    poller.start();
    await vi.advanceTimersByTimeAsync(600);
    expect(samples).toEqual([{ rpm: 3000, t: 1_000_550 }]); // midpoint of 500..600, not 0..600
    expect(poller.stats().avgRttMs).toBe(100);
    poller.stop();
  });

  it('passes its request timeout to the reader', async () => {
    const { poller, reader } = setup({ requestTimeoutMs: 300 });
    poller.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(reader.calls[0]).toMatchObject({ timeoutMs: 300 });
    poller.stop();
  });

  it('reports stats every second', async () => {
    const { poller, reader, stats } = setup();
    reader.results.push(new Error('timeout'));
    poller.start();
    await vi.advanceTimersByTimeAsync(2000);

    expect(stats).toHaveLength(2);
    const last = stats[1];
    // 18 answers by the time the timer fires at 2000 ms (the 19th is due at the same instant
    // but its timer was created later), one request failed → 9 samples/s.
    expect(last.samplesPerSec).toBe(9);
    expect(last.avgRttMs).toBe(100);
    expect(last.p95RttMs).toBe(100);
    expect(last.errors).toBe(1);
    expect(last.consecutiveErrors).toBe(0);
    poller.stop();
  });

  it('computes p95 round trip', async () => {
    const { poller, reader } = setup({ statsWindowMs: 10_000 });
    poller.start();
    await vi.advanceTimersByTimeAsync(3900); // 39 answers at 100 ms
    reader.latencyMs = 300;
    await vi.advanceTimersByTimeAsync(100); // the in-flight request still takes 100 ms
    await vi.advanceTimersByTimeAsync(300); // then one slow answer: 40 × 100 ms + 1 × 300 ms

    const stats = poller.stats();
    expect(stats.p95RttMs).toBe(100); // one outlier in 41 is above the 95th percentile
    expect(stats.avgRttMs).toBeCloseTo((40 * 100 + 300) / 41, 5);
    poller.stop();
  });

  it('becomes disconnected after 5 errors in a row and stops polling', async () => {
    const { poller, reader, states, errors } = setup();
    for (let i = 0; i < 5; i++) reader.results.push(new Error('timeout'));
    poller.start();
    await vi.advanceTimersByTimeAsync(500);

    expect(poller.state).toBe('disconnected');
    expect(states).toEqual(['running', 'disconnected']);
    expect(errors).toHaveLength(5);

    await vi.advanceTimersByTimeAsync(1000);
    expect(reader.calls).toHaveLength(5);
  });

  it('resets the error count after a good sample', async () => {
    const { poller, reader } = setup();
    const e = () => new Error('timeout');
    reader.results.push(e(), e(), e(), e(), 3000, e(), e(), e(), e());
    poller.start();
    await vi.advanceTimersByTimeAsync(900);
    expect(poller.state).toBe('running');
    poller.stop();
  });

  it('counts an answer without RPM as an error', async () => {
    const { poller, reader, samples } = setup();
    reader.results.push(null, null, null, null, null);
    poller.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(samples).toEqual([]);
    expect(poller.state).toBe('disconnected');
  });

  it('gives up at once when the transport is disconnected', async () => {
    const { poller, reader } = setup();
    reader.results.push(new DisconnectedError('010C: connection closed', '010C'));
    poller.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(poller.state).toBe('disconnected');
    expect(reader.calls).toHaveLength(1);
  });

  it('emits nothing after stop(), even for the answer in flight', async () => {
    const { poller, reader, samples, states } = setup();
    poller.start();
    await vi.advanceTimersByTimeAsync(50);
    poller.stop();
    await vi.advanceTimersByTimeAsync(2000);

    expect(samples).toEqual([]);
    expect(reader.calls).toHaveLength(1);
    expect(states).toEqual(['running', 'stopped']);
  });

  it('can start again after being disconnected', async () => {
    const { poller, reader, samples } = setup();
    reader.results.push(new DisconnectedError('gone', '010C'));
    poller.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(poller.state).toBe('disconnected');

    poller.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(poller.state).toBe('running');
    expect(samples).toHaveLength(2);
    expect(poller.stats().errors).toBe(0);
    poller.stop();
  });
});
