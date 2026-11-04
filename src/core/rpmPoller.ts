import { DisconnectedError } from './elm327Errors';
import { Emitter } from './emitter';

export interface RpmSample {
  rpm: number;
  /** Best estimate of when the ECU measured it: midpoint between request and answer (ms). */
  t: number;
}

export interface PollerStats {
  samplesPerSec: number;
  avgRttMs: number;
  p95RttMs: number;
  /** Failed requests since start(). */
  errors: number;
  consecutiveErrors: number;
}

export type PollerState = 'stopped' | 'running' | 'disconnected';

/** What the poller needs from the driver. Elm327 implements it. */
export interface RpmReader {
  /** `onSent` must be called when the request is really written (it may wait in a queue first). */
  readRpm(options?: { timeoutMs?: number; onSent?: () => void }): Promise<number | null>;
}

export type RpmPollerEvents = {
  sample: RpmSample;
  stats: PollerStats;
  state: PollerState;
  error: Error;
};

export interface RpmPollerOptions {
  /** Per-request timeout. Shorter than the driver default so a lost request costs less. */
  requestTimeoutMs?: number;
  /** After this many failures in a row the poller gives up and reports `disconnected`. */
  maxConsecutiveErrors?: number;
  statsIntervalMs?: number;
  /** Stats cover this sliding window. */
  statsWindowMs?: number;
  now?: () => number;
}

/**
 * Requests RPM back-to-back: the next request starts as soon as the previous one finished,
 * with no fixed interval, so the sample rate is as high as the link allows.
 */
export class RpmPoller {
  private readonly events = new Emitter<RpmPollerEvents>();
  private readonly requestTimeoutMs: number;
  private readonly maxConsecutiveErrors: number;
  private readonly statsIntervalMs: number;
  private readonly statsWindowMs: number;
  private readonly now: () => number;

  private currentState: PollerState = 'stopped';
  /** Bumped on start/stop, so a loop from an earlier run knows it is obsolete. */
  private runId = 0;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private recent: { t: number; rttMs: number }[] = [];
  private errors = 0;
  private consecutiveErrors = 0;

  constructor(
    private readonly reader: RpmReader,
    options: RpmPollerOptions = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 500;
    this.maxConsecutiveErrors = options.maxConsecutiveErrors ?? 5;
    this.statsIntervalMs = options.statsIntervalMs ?? 1000;
    this.statsWindowMs = options.statsWindowMs ?? 2000;
    this.now = options.now ?? (() => Date.now());
  }

  get state(): PollerState {
    return this.currentState;
  }

  on<K extends keyof RpmPollerEvents>(
    event: K,
    listener: (payload: RpmPollerEvents[K]) => void,
  ): () => void {
    return this.events.on(event, listener);
  }

  start(): void {
    if (this.currentState === 'running') return;
    this.runId++;
    this.startedAt = this.now();
    this.recent = [];
    this.errors = 0;
    this.consecutiveErrors = 0;
    this.statsTimer = setInterval(
      () => this.events.emit('stats', this.stats()),
      this.statsIntervalMs,
    );
    this.setState('running');
    void this.loop(this.runId);
  }

  stop(): void {
    if (this.currentState !== 'running') return;
    this.halt('stopped');
  }

  /** Current statistics over the sliding window. */
  stats(): PollerStats {
    const now = this.now();
    this.recent = this.recent.filter((entry) => entry.t >= now - this.statsWindowMs);
    const spanMs = Math.min(this.statsWindowMs, now - this.startedAt);
    const rtts = this.recent.map((entry) => entry.rttMs).sort((a, b) => a - b);
    return {
      samplesPerSec: spanMs > 0 ? (this.recent.length * 1000) / spanMs : 0,
      avgRttMs: rtts.length > 0 ? rtts.reduce((a, b) => a + b, 0) / rtts.length : 0,
      p95RttMs: rtts.length > 0 ? rtts[Math.ceil(rtts.length * 0.95) - 1] : 0,
      errors: this.errors,
      consecutiveErrors: this.consecutiveErrors,
    };
  }

  // Note: the reader must really wait for I/O. A reader that resolves instantly would make
  // this loop spin on microtasks and starve timers. Real transports always wait.
  private async loop(runId: number): Promise<void> {
    while (runId === this.runId) {
      // Start of the round trip = when the request is actually written, not when we asked:
      // after a timeout the driver first waits for the late answer to drain.
      let t0 = this.now();
      let rpm: number | null = null;
      let failure: Error | null = null;
      try {
        rpm = await this.reader.readRpm({
          timeoutMs: this.requestTimeoutMs,
          onSent: () => {
            t0 = this.now();
          },
        });
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
      }
      if (runId !== this.runId) return; // stopped while waiting: discard the answer
      const t1 = this.now();

      if (failure === null && rpm !== null) {
        this.consecutiveErrors = 0;
        this.recent.push({ t: t1, rttMs: t1 - t0 });
        this.events.emit('sample', { rpm, t: (t0 + t1) / 2 });
        continue;
      }

      this.errors++;
      this.consecutiveErrors++;
      const error = failure ?? new Error('Answer contained no RPM');
      this.events.emit('error', error);
      if (
        error instanceof DisconnectedError ||
        this.consecutiveErrors >= this.maxConsecutiveErrors
      ) {
        this.halt('disconnected');
        return;
      }
    }
  }

  private halt(state: PollerState): void {
    this.runId++;
    if (this.statsTimer !== null) clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.setState(state);
  }

  private setState(state: PollerState): void {
    if (state === this.currentState) return;
    this.currentState = state;
    this.events.emit('state', state);
  }
}
