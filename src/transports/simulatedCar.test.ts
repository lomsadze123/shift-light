import { describe, expect, it } from 'vitest';

import { mulberry32 } from '../core/random';
import { type Scenario, SimulatedCar } from './simulatedCar';

/** A car on a manual clock. `run(ms)` moves time forward and samples every `everyMs`. */
function harness(scenario: Scenario, seed = 1) {
  let t = 0;
  const car = new SimulatedCar({ scenario, now: () => t, random: mulberry32(seed) });
  const run = (ms: number, everyMs = 10) => {
    const samples: { t: number; rpm: number; gear: number }[] = [];
    const end = t + ms;
    while (t < end) {
      t += everyMs;
      samples.push({ t, rpm: car.rpm(), gear: car.gear });
    }
    return samples;
  };
  return { car, run };
}

describe('SimulatedCar pull', () => {
  it('starts at idle in 1st gear', () => {
    const { car } = harness('pull');
    expect(car.rpm()).toBe(800);
    expect(car.gear).toBe(1);
  });

  it('holds idle, then rises at the 1st-gear rate', () => {
    const { car, run } = harness('pull');
    run(1500);
    expect(car.rpm()).toBe(800);
    run(500);
    expect(car.rpm()).toBeCloseTo(800 + 3200 * 0.5, -1);
  });

  it('drops RPM by the gear ratio step at the first shift', () => {
    const { run } = harness('pull');
    const samples = run(5000, 5);
    const shift = samples.findIndex((s) => s.gear === 2);
    expect(shift).toBeGreaterThan(0);

    const before = samples[shift - 1].rpm;
    const after = samples[shift].rpm;
    expect(before).toBeGreaterThan(5900);
    expect(after).toBeCloseTo(6000 * (2.28 / 3.5), -2); // ≈ 3900
  });

  it('pauses briefly during a shift', () => {
    const { run } = harness('pull');
    const samples = run(5000, 5);
    const shift = samples.findIndex((s) => s.gear === 2);
    const afterShift = samples[shift].rpm;
    expect(samples[shift + 40].rpm).toBe(afterShift); // 200 ms later: still in the shift
    expect(samples[shift + 80].rpm).toBeGreaterThan(afterShift); // 400 ms later: accelerating
  });

  it('pulls through all gears, coasts to idle and starts again', () => {
    const { run } = harness('pull');
    const samples = run(40_000);
    const gears = samples.map((s) => s.gear);

    expect(Math.max(...gears)).toBe(6);
    const topIndex = gears.indexOf(6);
    const backToFirst = gears.indexOf(1, topIndex);
    expect(backToFirst).toBeGreaterThan(topIndex);
    expect(samples[backToFirst].rpm).toBe(800);
    // ...and a second pull happens
    expect(gears.indexOf(2, backToFirst)).toBeGreaterThan(backToFirst);
  });

  it('stays between idle and redline', () => {
    const { run } = harness('pull');
    for (const { rpm } of run(60_000)) {
      expect(rpm).toBeGreaterThanOrEqual(800);
      expect(rpm).toBeLessThanOrEqual(6800);
    }
  });
});

describe('SimulatedCar cruise', () => {
  it('stays near the target RPM in 4th gear', () => {
    const { run } = harness('cruise');
    const samples = run(60_000);
    for (const { rpm, gear } of samples) {
      expect(Math.abs(rpm - 2500)).toBeLessThanOrEqual(150);
      expect(gear).toBe(4);
    }
    // ...but it is not a flat line
    const rpms = samples.map((s) => s.rpm);
    expect(Math.max(...rpms) - Math.min(...rpms)).toBeGreaterThan(20);
  });
});

describe('SimulatedCar random', () => {
  it('stays between idle and redline and uses several gears', () => {
    const { run } = harness('random');
    const samples = run(120_000);
    for (const { rpm } of samples) {
      expect(rpm).toBeGreaterThanOrEqual(800);
      expect(rpm).toBeLessThanOrEqual(6800);
    }
    expect(new Set(samples.map((s) => s.gear)).size).toBeGreaterThanOrEqual(3);
  });

  it('is reproducible with the same seed', () => {
    const a = harness('random', 42).run(20_000);
    const b = harness('random', 42).run(20_000);
    expect(a).toEqual(b);
  });

  it('does not depend on how often it is queried', () => {
    const often = harness('random', 7);
    often.run(10_000, 5);
    const rarely = harness('random', 7);
    rarely.run(10_000, 2500);
    expect(rarely.car.rpm()).toBe(often.car.rpm());
    expect(rarely.car.gear).toBe(often.car.gear);
  });
});

describe('SimulatedCar options', () => {
  it('rejects mismatched gear tables', () => {
    expect(() => new SimulatedCar({ riseRates: [1000], gearRatios: [3, 2] })).toThrow();
  });
});
