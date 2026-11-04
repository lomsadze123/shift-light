import type { Random } from '../core/random';
import type { Transport } from '../core/transport';
import { SimulatedCar } from './simulatedCar';

/** Anything that can report engine RPM. SimulatedCar is one; tests use simple stubs. */
export interface RpmSource {
  rpm(): number;
}

export interface MockTransportOptions {
  car?: RpmSource;
  /** Base delay between a command and its answer. */
  latencyMs?: number;
  /** Extra random delay, 0..jitterMs, added to each answer. */
  jitterMs?: number;
  /** Probability that an RPM request gets no answer at all. */
  timeoutRate?: number;
  random?: Random;
  connectDelayMs?: number;
}

const VERSION = 'ELM327 v1.5';
const SEARCH_DELAY_MS = 300;
const MAX_CHUNK = 8;
// 41 00 + bitmask of supported PIDs 01–20. 0x3F in the second byte includes PID 0C.
const SUPPORTED_PIDS = [0x41, 0x00, 0xbe, 0x3f, 0xa8, 0x13];

type Timer = ReturnType<typeof setTimeout>;

/**
 * A fake ELM327 adapter connected to a simulated car. It talks the same text protocol as a
 * real adapter (echo, spaces, SEARCHING..., '>' prompt, STOPPED when interrupted), with
 * BLE-like latency, random chunking and occasional lost requests. Everything above the
 * Transport interface cannot tell it apart from the real thing.
 */
export class MockTransport implements Transport {
  readonly car: RpmSource;
  private readonly latencyMs: number;
  private readonly jitterMs: number;
  private readonly timeoutRate: number;
  private readonly random: Random;
  private readonly connectDelayMs: number;

  private connected = false;
  private input = '';
  private busy = false;
  private pendingTimer: Timer | null = null;
  private readonly timers = new Set<Timer>();
  private readonly dataListeners = new Set<(chunk: string) => void>();
  private readonly closeListeners = new Set<(error?: Error) => void>();

  // Adapter settings, as changed by AT commands.
  private echo = true;
  private spaces = true;
  private linefeeds = false;
  private protocolFound = false;

  constructor(options: MockTransportOptions = {}) {
    this.random = options.random ?? Math.random;
    this.car = options.car ?? new SimulatedCar({ random: this.random });
    this.latencyMs = options.latencyMs ?? 60;
    this.jitterMs = options.jitterMs ?? 60;
    this.timeoutRate = options.timeoutRate ?? 0.01;
    this.connectDelayMs = options.connectDelayMs ?? 50;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  connect(): Promise<void> {
    if (this.connected) return Promise.reject(new Error('Already connected'));
    return new Promise<void>((resolve) => {
      this.schedule(() => {
        this.connected = true;
        this.resetAdapter();
        resolve();
      }, this.connectDelayMs);
    });
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.connected = false;
    this.busy = false;
    this.pendingTimer = null;
    this.input = '';
    for (const listener of [...this.closeListeners]) listener(undefined);
  }

  async write(text: string): Promise<void> {
    if (!this.connected) throw new Error('Not connected');
    this.input += text;
    let end = this.input.indexOf('\r');
    while (end !== -1) {
      const command = this.input.slice(0, end).replace(/\s+/g, '').toUpperCase();
      this.input = this.input.slice(end + 1);
      if (command !== '') this.receive(command);
      end = this.input.indexOf('\r');
    }
  }

  onData(listener: (chunk: string) => void): () => void {
    this.dataListeners.add(listener);
    return () => {
      this.dataListeners.delete(listener);
    };
  }

  onClose(listener: (error?: Error) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  private receive(command: string): void {
    if (this.busy) {
      // A real ELM327 aborts the running command when new input arrives.
      this.cancelPending();
      this.sendAnswer(null, ['STOPPED']);
      return;
    }

    const isDataRequest = /^01[0-9A-F]{2}/.test(command) && command !== '0100';
    if (isDataRequest && this.random() < this.timeoutRate) return; // lost request: no answer

    const echoed = this.echo ? command : null;
    const searching = command === '0100' && !this.protocolFound;
    const delay =
      this.latencyMs + this.random() * this.jitterMs + (searching ? SEARCH_DELAY_MS : 0);

    // Measure the car halfway through the delay (request in flight → ECU reads RPM → answer
    // in flight), then send the answer at the end.
    this.busy = true;
    this.pendingTimer = this.schedule(() => {
      const lines = this.answer(command);
      if (searching) lines.unshift('SEARCHING...');
      this.pendingTimer = this.schedule(() => {
        this.busy = false;
        this.pendingTimer = null;
        this.sendAnswer(echoed, lines);
      }, delay / 2);
    }, delay / 2);
  }

  private answer(command: string): string[] {
    switch (command) {
      case 'ATZ':
      case 'ATWS':
        this.resetAdapter();
        return [VERSION];
      case 'ATI':
        return [VERSION];
      case 'ATRV':
        return ['12.6V'];
      case 'ATDPN':
        return ['A6'];
      case 'ATE0':
      case 'ATE1':
        this.echo = command === 'ATE1';
        return ['OK'];
      case 'ATS0':
      case 'ATS1':
        this.spaces = command === 'ATS1';
        return ['OK'];
      case 'ATL0':
      case 'ATL1':
        this.linefeeds = command === 'ATL1';
        return ['OK'];
      case '0100':
        this.protocolFound = true;
        return [this.hex(SUPPORTED_PIDS)];
      case '010C':
      case '010C1': {
        const raw = Math.min(Math.max(Math.round(this.car.rpm() * 4), 0), 0xffff);
        return [this.hex([0x41, 0x0c, raw >> 8, raw & 0xff])];
      }
    }
    if (command.startsWith('ATSP')) {
      this.protocolFound = false;
      return ['OK'];
    }
    if (command.startsWith('AT')) return ['OK'];
    return ['NO DATA'];
  }

  private resetAdapter(): void {
    this.echo = true;
    this.spaces = true;
    this.linefeeds = false;
    this.protocolFound = false;
  }

  private hex(bytes: readonly number[]): string {
    const parts = bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0'));
    return parts.join(this.spaces ? ' ' : '');
  }

  private sendAnswer(echoed: string | null, lines: readonly string[]): void {
    const eol = this.linefeeds ? '\r\n' : '\r';
    const echoPart = echoed === null ? '' : echoed + eol;
    this.deliverChunked(`${echoPart}${lines.join(eol)}${eol}${eol}>`);
  }

  /** Split the text into random 1–8 character chunks, each delivered in its own tick. */
  private deliverChunked(text: string): void {
    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) {
      const size = 1 + Math.floor(this.random() * MAX_CHUNK);
      chunks.push(text.slice(i, i + size));
      i += size;
    }
    const next = () => {
      const chunk = chunks.shift();
      if (chunk === undefined) return;
      for (const listener of [...this.dataListeners]) listener(chunk);
      if (chunks.length > 0) this.schedule(next, 0);
    };
    this.schedule(next, 0);
  }

  private cancelPending(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.timers.delete(this.pendingTimer);
    }
    this.pendingTimer = null;
    this.busy = false;
  }

  private schedule(fn: () => void, ms: number): Timer {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
    return timer;
  }
}
