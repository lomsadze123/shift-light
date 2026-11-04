import type { RpmSample } from './rpmPoller';

export interface ShiftLightConfig {
  thresholdRpm: number;
  /** Once on, RPM must fall this far below the threshold before the light may turn off. */
  hysteresisRpm: number;
  /** Extra lead time for what happens after the decision (screen, eyes, hand). Calibrated in the car. */
  leadMs: number;
  /** The light stays on at least this long, so it never just blinks. */
  minOnMs: number;
  /** No sample for longer than this → data is stale → light off, NO DATA. */
  staleMs: number;
  /** The RPM rise rate is estimated over samples from this window. */
  rateWindowMs: number;
  /** Fewer samples than this → no rate estimate, no prediction. */
  minRateSamples: number;
}

export const DEFAULT_SHIFT_LIGHT_CONFIG: Omit<ShiftLightConfig, 'thresholdRpm'> = {
  hysteresisRpm: 200,
  leadMs: 150,
  minOnMs: 300,
  staleMs: 500,
  // PLAN.md suggested ~600 ms. 400 ms (≈4 samples at 10 Hz) adapts faster after a shift:
  // with 600 ms the window still held the flat post-shift samples, so the light fired late.
  rateWindowMs: 400,
  minRateSamples: 3,
};

export interface ShiftLightState {
  active: boolean;
  /** Last measured RPM, or null when stale. */
  rpm: number | null;
  /** Expected RPM `leadMs` from now, or null when stale. */
  predictedRpm: number | null;
  /** Estimated RPM change per second (0 if unknown). */
  ratePerSec: number;
  /** True when there is no fresh data: the UI must show NO DATA. */
  stale: boolean;
}

/**
 * Decides whether the shift light should be on. Pure logic, no timers: the caller passes the
 * time. Call update() for every new sample AND regularly without one (e.g. every frame), so
 * the prediction keeps moving between samples and stale data is detected.
 */
export class ShiftLight {
  private config: ShiftLightConfig;
  private samples: RpmSample[] = [];
  private active = false;
  private onSince = 0;

  constructor(config: Partial<ShiftLightConfig> & Pick<ShiftLightConfig, 'thresholdRpm'>) {
    this.config = { ...DEFAULT_SHIFT_LIGHT_CONFIG, ...config };
  }

  get currentConfig(): Readonly<ShiftLightConfig> {
    return this.config;
  }

  /** Change settings at runtime (threshold, leadMs, ...). */
  setConfig(changes: Partial<ShiftLightConfig>): void {
    this.config = { ...this.config, ...changes };
  }

  reset(): void {
    this.samples = [];
    this.active = false;
  }

  update(sample: RpmSample | null, now: number): ShiftLightState {
    if (sample) this.addSample(sample);
    const { thresholdRpm, hysteresisRpm, leadMs, minOnMs, staleMs } = this.config;

    const last = this.samples.at(-1);
    if (!last || now - last.t > staleMs) {
      // Fail safe: without fresh data the light is off and nothing is shown.
      this.active = false;
      return { active: false, rpm: null, predictedRpm: null, ratePerSec: 0, stale: true };
    }

    const rate = this.ratePerSec();
    const ageMs = Math.max(0, now - last.t);
    // Only predict upwards: a falling RPM must never fire the light early.
    const predicted = rate > 0 ? last.rpm + (rate * (leadMs + ageMs)) / 1000 : last.rpm;

    if (!this.active) {
      if (last.rpm >= thresholdRpm || (rate > 0 && predicted >= thresholdRpm)) {
        this.active = true;
        this.onSince = now;
      }
    } else if (
      last.rpm < thresholdRpm - hysteresisRpm &&
      predicted < thresholdRpm &&
      now - this.onSince >= minOnMs
    ) {
      this.active = false;
    }

    return {
      active: this.active,
      rpm: last.rpm,
      predictedRpm: predicted,
      ratePerSec: rate,
      stale: false,
    };
  }

  private addSample(sample: RpmSample): void {
    const last = this.samples.at(-1);
    if (last && sample.t <= last.t) return; // duplicate or out of order
    this.samples.push(sample);
    const cutoff = sample.t - this.config.rateWindowMs;
    while (this.samples[0].t < cutoff) this.samples.shift();
  }

  /**
   * Least-squares slope of RPM over time (the best-fit straight line through the recent
   * samples). Smooths out noise better than comparing just the last two samples.
   */
  private ratePerSec(): number {
    const n = this.samples.length;
    if (n < this.config.minRateSamples) return 0;

    const meanT = this.samples.reduce((sum, s) => sum + s.t, 0) / n;
    const meanRpm = this.samples.reduce((sum, s) => sum + s.rpm, 0) / n;
    let covariance = 0;
    let variance = 0;
    for (const s of this.samples) {
      covariance += (s.t - meanT) * (s.rpm - meanRpm);
      variance += (s.t - meanT) ** 2;
    }
    return variance === 0 ? 0 : (covariance / variance) * 1000; // per ms → per second
  }
}
