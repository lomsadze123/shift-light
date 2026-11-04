import { describe, expect, it } from 'vitest';

import { mulberry32 } from './random';
import type { RpmSample } from './rpmPoller';
import { ShiftLight, type ShiftLightConfig } from './shiftLight';

const SAMPLE_PERIOD_MS = 100; // one answer every 100 ms
const LATENCY_MS = 100; // each answer measured 50 ms before it arrives
const FRAME_MS = 10;

interface Frame {
  t: number;
  trueRpm: number;
  active: boolean;
  stale: boolean;
}

/**
 * Drive a ShiftLight like the app does: a new sample arrives every 100 ms (measured at the
 * request midpoint, 50 ms earlier) and update() runs every 10 ms frame in between.
 */
function drive(
  config: Partial<ShiftLightConfig> & Pick<ShiftLightConfig, 'thresholdRpm'>,
  trueRpm: (t: number) => number,
  durationMs: number,
  options: { stopSamplesAt?: number } = {},
): { light: ShiftLight; frames: Frame[] } {
  const light = new ShiftLight(config);
  const frames: Frame[] = [];
  for (let t = 0; t <= durationMs; t += FRAME_MS) {
    let sample: RpmSample | null = null;
    const arrives = t > 0 && t % SAMPLE_PERIOD_MS === 0;
    if (arrives && (options.stopSamplesAt === undefined || t < options.stopSamplesAt)) {
      const measuredAt = t - LATENCY_MS / 2;
      sample = { rpm: trueRpm(measuredAt), t: measuredAt };
    }
    const state = light.update(sample, t);
    frames.push({ t, trueRpm: trueRpm(t), active: state.active, stale: state.stale });
  }
  return { light, frames };
}

function turnOns(frames: readonly Frame[]): Frame[] {
  return frames.filter((f, i) => f.active && (i === 0 || !frames[i - 1].active));
}

describe('ShiftLight prediction', () => {
  it('fires before the threshold by about rate × leadMs on a steady climb', () => {
    const rate = 3000; // RPM per second, like 1st gear
    const { frames } = drive(
      { thresholdRpm: 5000, leadMs: 150 },
      (t) => 2000 + rate * (t / 1000),
      2000,
    );

    const [fire] = turnOns(frames);
    expect(fire).toBeDefined();
    const expected = 5000 - rate * 0.15; // 4550
    expect(fire.trueRpm).toBeGreaterThanOrEqual(expected - 60);
    expect(fire.trueRpm).toBeLessThanOrEqual(expected + 60);
  });

  it('fires at the threshold itself with leadMs = 0', () => {
    const { frames } = drive(
      { thresholdRpm: 5000, leadMs: 0 },
      (t) => 2000 + 3000 * (t / 1000),
      2000,
    );
    const [fire] = turnOns(frames);
    expect(Math.abs(fire.trueRpm - 5000)).toBeLessThanOrEqual(60);
  });

  it('a larger leadMs fires earlier', () => {
    const climb = (t: number) => 2000 + 2000 * (t / 1000);
    const early = turnOns(drive({ thresholdRpm: 5000, leadMs: 300 }, climb, 3000).frames)[0];
    const late = turnOns(drive({ thresholdRpm: 5000, leadMs: 50 }, climb, 3000).frames)[0];
    expect(early.t).toBeLessThan(late.t);
  });

  it('needs at least 3 samples before predicting', () => {
    const light = new ShiftLight({ thresholdRpm: 5000, leadMs: 500 });
    expect(light.update({ rpm: 4700, t: 0 }, 50).active).toBe(false);
    // 2 samples, rising 2000 RPM/s: a prediction would already fire, but no rate yet
    const second = light.update({ rpm: 4900, t: 100 }, 150);
    expect(second.ratePerSec).toBe(0);
    expect(second.active).toBe(false);
    expect(light.update({ rpm: 4950, t: 200 }, 250).active).toBe(true);
  });

  it('never fires early on falling RPM', () => {
    const { frames } = drive(
      { thresholdRpm: 5000, leadMs: 1000 },
      (t) => 4990 - 3000 * (t / 1000),
      1000,
    );
    expect(turnOns(frames)).toEqual([]);
  });
});

describe('ShiftLight hysteresis', () => {
  it('does not flicker with noisy RPM around the threshold', () => {
    const random = mulberry32(5);
    const noise = new Map<number, number>();
    const noisy = (t: number) => {
      if (!noise.has(t)) noise.set(t, 5000 + (random() - 0.5) * 200);
      return noise.get(t) as number;
    };
    const { frames } = drive({ thresholdRpm: 5000 }, noisy, 10_000);
    expect(turnOns(frames)).toHaveLength(1);
    expect(frames.at(-1)?.active).toBe(true);
  });

  it('turns off after the RPM drop of a shift', () => {
    // climb at 3000 RPM/s, shift at t = 1500 ms (6500 → 4200), then keep climbing
    const shift = (t: number) => (t < 1500 ? 2000 + 3 * t : 4200 + 2 * (t - 1500));
    const { frames } = drive({ thresholdRpm: 6000 }, shift, 2500);

    const [fire] = turnOns(frames);
    expect(fire.t).toBeLessThan(1500);
    const offAt = frames.find((f) => f.t > 1500 && !f.active);
    expect(offAt).toBeDefined();
    expect((offAt as Frame).t).toBeLessThanOrEqual(1500 + 100 + FRAME_MS); // next sample
  });

  it('stays on for at least minOnMs', () => {
    const light = new ShiftLight({ thresholdRpm: 5000, minOnMs: 300 });
    expect(light.update({ rpm: 5100, t: 0 }, 0).active).toBe(true);
    expect(light.update({ rpm: 3000, t: 100 }, 100).active).toBe(true); // dropped, but too soon
    expect(light.update(null, 299).active).toBe(true);
    expect(light.update(null, 300).active).toBe(false);
  });

  it('stays on while RPM is within the hysteresis band', () => {
    const light = new ShiftLight({ thresholdRpm: 5000, hysteresisRpm: 200, minOnMs: 0 });
    light.update({ rpm: 5050, t: 0 }, 0);
    expect(light.update({ rpm: 4850, t: 100 }, 100).active).toBe(true);
    expect(light.update({ rpm: 4790, t: 200 }, 200).active).toBe(false);
  });
});

describe('ShiftLight fail-safe', () => {
  it('is off and stale before any sample', () => {
    const light = new ShiftLight({ thresholdRpm: 5000 });
    expect(light.update(null, 0)).toEqual({
      active: false,
      rpm: null,
      predictedRpm: null,
      ratePerSec: 0,
      stale: true,
    });
  });

  it('turns off and reports NO DATA when samples stop, even above the threshold', () => {
    const { frames } = drive({ thresholdRpm: 5000 }, () => 6000, 2000, { stopSamplesAt: 1000 });

    const lastSampleAt = 900 - LATENCY_MS / 2; // measured time of the last sample
    const beforeStale = frames.find((f) => f.t === lastSampleAt + 500);
    const afterStale = frames.find((f) => f.t === lastSampleAt + 510);
    expect(beforeStale?.active).toBe(true);
    expect(afterStale?.active).toBe(false);
    expect(afterStale?.stale).toBe(true);
  });

  it('reports null RPM while stale', () => {
    const light = new ShiftLight({ thresholdRpm: 5000, staleMs: 500 });
    light.update({ rpm: 6000, t: 0 }, 0);
    expect(light.update(null, 501)).toMatchObject({ active: false, rpm: null, stale: true });
  });

  it('recovers when data resumes', () => {
    const light = new ShiftLight({ thresholdRpm: 5000, staleMs: 500 });
    light.update({ rpm: 3000, t: 0 }, 0);
    expect(light.update(null, 1000).stale).toBe(true);
    expect(light.update({ rpm: 3100, t: 1000 }, 1050)).toMatchObject({ stale: false, rpm: 3100 });
  });
});

describe('ShiftLight config', () => {
  it('applies setConfig changes immediately', () => {
    const light = new ShiftLight({ thresholdRpm: 6000 });
    expect(light.update({ rpm: 5500, t: 0 }, 0).active).toBe(false);
    light.setConfig({ thresholdRpm: 5400 });
    expect(light.update(null, 10).active).toBe(true);
    expect(light.currentConfig.thresholdRpm).toBe(5400);
    expect(light.currentConfig.leadMs).toBe(150);
  });

  it('ignores duplicate and out-of-order samples', () => {
    const light = new ShiftLight({ thresholdRpm: 5000 });
    light.update({ rpm: 3000, t: 100 }, 100);
    expect(light.update({ rpm: 9000, t: 50 }, 110).rpm).toBe(3000);
    expect(light.update({ rpm: 9000, t: 100 }, 120).rpm).toBe(3000);
  });

  it('reset() clears history and turns the light off', () => {
    const light = new ShiftLight({ thresholdRpm: 5000 });
    light.update({ rpm: 6000, t: 0 }, 0);
    light.reset();
    expect(light.update(null, 10)).toMatchObject({ active: false, stale: true });
  });
});
