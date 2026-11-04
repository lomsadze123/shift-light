import type { Random } from '../core/random';

export type Scenario = 'pull' | 'cruise' | 'random';

export interface SimulatedCarOptions {
  scenario?: Scenario;
  /** RPM at which the simulated driver shifts up. */
  shiftRpm?: number;
  idleRpm?: number;
  redlineRpm?: number;
  /** Full-throttle RPM rise per second, per gear (1st first). */
  riseRates?: readonly number[];
  /** Gear ratios (1st first). Only their ratios to each other matter. */
  gearRatios?: readonly number[];
  /** Target RPM for the cruise scenario. */
  cruiseRpm?: number;
  /** Clock in milliseconds. Inject a fake one for deterministic tests. */
  now?: () => number;
  random?: Random;
}

const STEP_MS = 5; // simulation resolution
const MAX_CATCH_UP_MS = 60_000; // after a long pause, only simulate the last minute
const IDLE_HOLD_MS = 1500; // pull: time at idle between pulls
const SHIFT_PAUSE_MS = 250; // pull: no acceleration while the gear changes
const COAST_RATE = 1500; // pull: RPM/s drop after the last gear, back to idle
const ENGINE_BRAKE_RATE = 1200; // random: RPM/s drop with the throttle closed
const DOWNSHIFT_RPM = 1800; // random: shift down below this
const CRUISE_GEAR = 4;
const CRUISE_WANDER_LIMIT = 120;

type PullPhase = 'idle' | 'accelerate' | 'shift' | 'coast';

/**
 * A physics-ish engine RPM model with a simulated driver.
 *
 * The state only moves forward when someone asks (rpm() or gear): it then advances from the
 * last update to now() in fixed 5 ms steps. So the result does not depend on how often it is
 * queried, and with a fake clock and seeded random it is fully deterministic.
 */
export class SimulatedCar {
  readonly scenario: Scenario;
  readonly idleRpm: number;
  readonly redlineRpm: number;
  readonly shiftRpm: number;
  private readonly riseRates: readonly number[];
  private readonly gearRatios: readonly number[];
  private readonly cruiseRpm: number;
  private readonly now: () => number;
  private readonly random: Random;

  private currentRpm: number;
  private currentGear: number;
  private lastT: number;
  private phase: PullPhase = 'idle';
  private phaseMs = 0;
  private throttle = 0;
  private throttleHoldMs = 0;
  private wander = 0;

  constructor(options: SimulatedCarOptions = {}) {
    this.scenario = options.scenario ?? 'pull';
    this.idleRpm = options.idleRpm ?? 800;
    this.redlineRpm = options.redlineRpm ?? 6800;
    this.shiftRpm = Math.min(options.shiftRpm ?? 6000, this.redlineRpm);
    this.riseRates = options.riseRates ?? [3200, 2400, 1800, 1300, 1000, 800];
    this.gearRatios = options.gearRatios ?? [3.5, 2.28, 1.6, 1.2, 0.95, 0.78];
    this.cruiseRpm = options.cruiseRpm ?? 2500;
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;

    if (this.riseRates.length !== this.gearRatios.length) {
      throw new Error('riseRates and gearRatios must have one entry per gear');
    }

    this.lastT = this.now();
    if (this.scenario === 'cruise') {
      this.currentGear = Math.min(CRUISE_GEAR, this.topGear);
      this.currentRpm = this.cruiseRpm;
    } else {
      this.currentGear = 1;
      this.currentRpm = this.idleRpm;
    }
  }

  /** Current engine RPM. */
  rpm(): number {
    this.advance();
    return this.currentRpm;
  }

  /** Current gear, 1-based. */
  get gear(): number {
    this.advance();
    return this.currentGear;
  }

  private get topGear(): number {
    return this.gearRatios.length;
  }

  private advance(): void {
    const t = this.now();
    if (t - this.lastT > MAX_CATCH_UP_MS) this.lastT = t - MAX_CATCH_UP_MS;
    while (t - this.lastT >= STEP_MS) {
      this.step(STEP_MS);
      this.lastT += STEP_MS;
    }
  }

  private step(dtMs: number): void {
    const dt = dtMs / 1000;
    if (this.scenario === 'pull') this.stepPull(dt, dtMs);
    else if (this.scenario === 'cruise') this.stepCruise(dt);
    else this.stepRandom(dt, dtMs);
  }

  /** Full-throttle pulls through every gear, coast back to idle, repeat. */
  private stepPull(dt: number, dtMs: number): void {
    this.phaseMs += dtMs;
    switch (this.phase) {
      case 'idle':
        this.currentRpm = this.idleRpm;
        if (this.phaseMs >= IDLE_HOLD_MS) this.enterPhase('accelerate');
        break;

      case 'accelerate':
        this.currentRpm = Math.min(
          this.currentRpm + this.riseRates[this.currentGear - 1] * dt,
          this.redlineRpm,
        );
        if (this.currentRpm >= this.shiftRpm) {
          if (this.currentGear < this.topGear) {
            this.shiftTo(this.currentGear + 1);
            this.enterPhase('shift');
          } else {
            this.enterPhase('coast');
          }
        }
        break;

      case 'shift':
        if (this.phaseMs >= SHIFT_PAUSE_MS) this.enterPhase('accelerate');
        break;

      case 'coast':
        this.currentRpm -= COAST_RATE * dt;
        if (this.currentRpm <= this.idleRpm) {
          this.currentRpm = this.idleRpm;
          this.currentGear = 1;
          this.enterPhase('idle');
        }
        break;
    }
  }

  /** Steady RPM with a slow random wander (a mean-reverting random walk). */
  private stepCruise(dt: number): void {
    const pull = -this.wander * 0.5 * dt;
    const kick = (this.random() - 0.5) * 160 * Math.sqrt(dt);
    this.wander = clamp(this.wander + pull + kick, -CRUISE_WANDER_LIMIT, CRUISE_WANDER_LIMIT);
    this.currentRpm = this.cruiseRpm + this.wander;
  }

  /** The driver changes throttle every 0.5–2.5 s and shifts up/down as needed. */
  private stepRandom(dt: number, dtMs: number): void {
    this.phaseMs += dtMs;
    if (this.phaseMs >= this.throttleHoldMs) {
      this.throttle = this.random();
      this.throttleHoldMs = 500 + this.random() * 2000;
      this.phaseMs = 0;
    }

    const rise = this.riseRates[this.currentGear - 1];
    const rate = this.throttle * rise - (1 - this.throttle) * ENGINE_BRAKE_RATE;
    this.currentRpm += rate * dt;

    if (this.currentRpm >= this.shiftRpm && this.currentGear < this.topGear) {
      this.shiftTo(this.currentGear + 1);
    } else if (this.currentRpm < DOWNSHIFT_RPM && this.currentGear > 1) {
      this.shiftTo(this.currentGear - 1);
    }
    this.currentRpm = clamp(this.currentRpm, this.idleRpm, this.redlineRpm);
  }

  /**
   * At the same road speed, engine RPM is proportional to the gear ratio, so the RPM after a
   * shift is rpm × newRatio / oldRatio (6000 in 1st → ≈3900 in 2nd).
   */
  private shiftTo(gear: number): void {
    const ratio = this.gearRatios[gear - 1] / this.gearRatios[this.currentGear - 1];
    this.currentRpm = clamp(this.currentRpm * ratio, this.idleRpm, this.redlineRpm);
    this.currentGear = gear;
  }

  private enterPhase(phase: PullPhase): void {
    this.phase = phase;
    this.phaseMs = 0;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
