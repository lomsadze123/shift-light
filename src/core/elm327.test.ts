import { afterEach, describe, expect, it, vi } from 'vitest';

import { DebugLog } from './debugLog';
import { Elm327, isAllowedCommand, normalizeCommand } from './elm327';
import {
  AdapterError,
  BusInitError,
  CanError,
  DisconnectedError,
  ForbiddenCommandError,
  NoDataError,
  StoppedError,
  TimeoutError,
  UnableToConnectError,
  UnsupportedCommandError,
} from './elm327Errors';
import type { Transport } from './transport';

/** Small deterministic PRNG so "random" chunking is reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A fake adapter. `responder` decides the answer to each command (null = stay silent).
 * Answers are split into random 1–5 character chunks, each delivered in its own microtask,
 * like data trickling in over BLE or TCP.
 */
class FakeTransport implements Transport {
  isConnected = true;
  readonly written: string[] = [];
  responder: (command: string) => string | null = () => null;
  private readonly dataListeners = new Set<(chunk: string) => void>();
  private readonly closeListeners = new Set<(error?: Error) => void>();

  constructor(private readonly random: () => number = mulberry32(1)) {}

  async connect(): Promise<void> {
    this.isConnected = true;
  }

  async disconnect(): Promise<void> {
    this.close();
  }

  async write(text: string): Promise<void> {
    if (!this.isConnected) throw new Error('Not connected');
    this.written.push(text);
    const answer = this.responder(text.replace(/\r$/, ''));
    if (answer !== null) this.deliverChunked(answer);
  }

  /** Commands written so far, without the trailing \r. */
  commands(): string[] {
    return this.written.map((text) => text.replace(/\r$/, ''));
  }

  deliverChunked(text: string): void {
    let delivery = Promise.resolve();
    let i = 0;
    while (i < text.length) {
      const size = 1 + Math.floor(this.random() * 5);
      const chunk = text.slice(i, i + size);
      delivery = delivery.then(() => this.emit(chunk));
      i += size;
    }
  }

  emit(chunk: string): void {
    for (const listener of [...this.dataListeners]) listener(chunk);
  }

  close(error?: Error): void {
    this.isConnected = false;
    for (const listener of [...this.closeListeners]) listener(error);
  }

  onData(listener: (chunk: string) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onClose(listener: (error?: Error) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }
}

/** Let pending microtasks and zero-delay work run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('allowlist', () => {
  it.each([
    'ATZ',
    'ATWS',
    'ATI',
    'ATE0',
    'ATE1',
    'ATL0',
    'ATS0',
    'ATH1',
    'ATSP0',
    'ATAT0',
    'ATAT2',
    'ATST32',
    'ATRV',
    'ATDPN',
    '0100',
    '010C',
    '010C1',
    '0105',
    '0902',
    'atz',
    ' 010c ',
  ])('allows %j', (command) => {
    expect(isAllowedCommand(command)).toBe(true);
  });

  it.each([
    '04', // clear trouble codes
    '0400',
    '2E1234AA', // write data by identifier
    '2F123403', // actuator control
    '3101FF00', // routine control
    '2701', // security access
    'ATPP0CSV23', // write adapter settings memory
    'ATPPS',
    'ATMA', // monitor all (floods the bus output)
    'ATSP6', // only automatic protocol is allowed
    'ATSTZZ',
    '03', // read stored codes: not needed, not allowed
    '010C11', // count is a single digit
    '010C0', // count 0 is meaningless
    '090', // incomplete
    '',
    '010C\r04', // second command smuggled in
    '010C\r',
    '01 0C', // spaces not accepted
    '010C;04',
  ])('rejects %j', (command) => {
    expect(isAllowedCommand(command)).toBe(false);
  });

  it('normalizes case and surrounding whitespace', () => {
    expect(normalizeCommand('  atz ')).toBe('ATZ');
    expect(normalizeCommand('01 0C')).toBeNull();
  });

  it('never writes a forbidden command', async () => {
    const transport = new FakeTransport();
    const log = new DebugLog();
    const elm = new Elm327(transport, log);

    for (const command of ['04', '2E1234AA', 'ATPP0CSV23', '010C\r04']) {
      await expect(elm.send(command)).rejects.toBeInstanceOf(ForbiddenCommandError);
    }

    expect(transport.written).toEqual([]);
    expect(log.entries().filter((e) => e.dir === 'error')).toHaveLength(4);
  });

  it('sends the normalized command', async () => {
    const transport = new FakeTransport();
    transport.responder = () => 'OK\r\r>';
    const elm = new Elm327(transport);
    await elm.send(' ate0 ');
    expect(transport.written).toEqual(['ATE0\r']);
  });
});

describe('send', () => {
  it('reassembles answers no matter how they are chunked', async () => {
    for (let seed = 1; seed <= 50; seed++) {
      const transport = new FakeTransport(mulberry32(seed));
      transport.responder = () => '410C1AF8\r410C09B0\r\r>';
      const elm = new Elm327(transport);
      await expect(elm.send('010C')).resolves.toEqual(['410C1AF8', '410C09B0']);
    }
  });

  it('strips the echo and SEARCHING...', async () => {
    const transport = new FakeTransport();
    transport.responder = (command) => `${command}\rSEARCHING...\r41 00 BE 3E B8 11\r\r>`;
    const elm = new Elm327(transport);
    await expect(elm.send('0100')).resolves.toEqual(['41 00 BE 3E B8 11']);
  });

  it('handles CR+LF line endings', async () => {
    const transport = new FakeTransport();
    transport.responder = () => 'OK\r\n\r\n>';
    const elm = new Elm327(transport);
    await expect(elm.send('ATE0')).resolves.toEqual(['OK']);
  });

  it('keeps only one command in flight and matches answers to callers', async () => {
    const transport = new FakeTransport();
    const elm = new Elm327(transport);

    const first = elm.send('ATE0');
    const second = elm.send('010C');
    await flush();
    expect(transport.commands()).toEqual(['ATE0']); // second waits for the first '>'

    transport.emit('O');
    transport.emit('K\r');
    await flush();
    expect(transport.commands()).toEqual(['ATE0']); // still no prompt

    transport.emit('\r>');
    await expect(first).resolves.toEqual(['OK']);
    await flush();
    expect(transport.commands()).toEqual(['ATE0', '010C']);

    transport.emit('410C1AF8\r\r>');
    await expect(second).resolves.toEqual(['410C1AF8']);
  });

  it('continues the queue after a failed command', async () => {
    const transport = new FakeTransport();
    transport.responder = (command) => (command === '0105' ? 'NO DATA\r\r>' : 'OK\r\r>');
    const elm = new Elm327(transport);

    const failing = elm.send('0105');
    const next = elm.send('ATE0');
    await expect(failing).rejects.toBeInstanceOf(NoDataError);
    await expect(next).resolves.toEqual(['OK']);
  });

  it.each([
    ['NO DATA', NoDataError],
    ['?', UnsupportedCommandError],
    ['UNABLE TO CONNECT', UnableToConnectError],
    ['CAN ERROR', CanError],
    ['BUS INIT: ...ERROR', BusInitError],
    ['STOPPED', StoppedError],
    ['BUFFER FULL', AdapterError],
    ['BUS ERROR', AdapterError],
    ['ERR94', AdapterError],
  ])('maps %j to a typed error', async (answer, ErrorClass) => {
    const transport = new FakeTransport();
    transport.responder = () => `SEARCHING...\r${answer}\r\r>`;
    const elm = new Elm327(transport);

    const error = await elm.send('010C').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorClass);
    expect(error).toMatchObject({ command: '010C' });
  });

  it('times out and then ignores the late answer', async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const elm = new Elm327(transport, undefined, { drainMs: 500 });

    const first = elm.send('010C', { timeoutMs: 100 });
    const firstRejected = expect(first).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await firstRejected;

    const second = elm.send('0100');
    await vi.advanceTimersByTimeAsync(10);
    expect(transport.commands()).toEqual(['010C']); // waiting for the late answer

    transport.emit('410C1AF8\r\r>'); // the late answer to 010C
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.commands()).toEqual(['010C', '0100']);

    transport.emit('4100BE3EB811\r\r>');
    await expect(second).resolves.toEqual(['4100BE3EB811']);
  });

  it('stops waiting for a late answer after drainMs', async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const elm = new Elm327(transport, undefined, { drainMs: 500 });

    const first = elm.send('010C', { timeoutMs: 100 });
    const firstRejected = expect(first).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await firstRejected;

    const second = elm.send('ATE0');
    await vi.advanceTimersByTimeAsync(499);
    expect(transport.commands()).toEqual(['010C']);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.commands()).toEqual(['010C', 'ATE0']);

    transport.emit('OK\r\r>');
    await expect(second).resolves.toEqual(['OK']);
  });

  it('rejects the in-flight command when the connection closes', async () => {
    const transport = new FakeTransport();
    const elm = new Elm327(transport);

    const pending = elm.send('010C');
    await flush();
    transport.close(new Error('ECONNRESET'));

    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DisconnectedError);
    expect((error as Error).message).toContain('ECONNRESET');
  });

  it('rejects commands while disconnected without writing', async () => {
    const transport = new FakeTransport();
    transport.isConnected = false;
    const elm = new Elm327(transport);
    await expect(elm.send('010C')).rejects.toBeInstanceOf(DisconnectedError);
    expect(transport.written).toEqual([]);
  });

  it('discards data that arrives with no command in flight', async () => {
    const transport = new FakeTransport();
    const elm = new Elm327(transport);
    transport.emit('\r>'); // stray prompt at connect
    transport.responder = () => 'OK\r\r>';
    await expect(elm.send('ATE0')).resolves.toEqual(['OK']);
  });

  it('logs TX and RX lines', async () => {
    const transport = new FakeTransport();
    transport.responder = () => '410C1AF8\r\r>';
    const log = new DebugLog();
    const elm = new Elm327(transport, log);
    await elm.send('010C');
    expect(log.entries().map(({ dir, text }) => ({ dir, text }))).toEqual([
      { dir: 'tx', text: '010C' },
      { dir: 'rx', text: '410C1AF8' },
    ]);
  });

  it('stops listening after dispose()', async () => {
    const transport = new FakeTransport();
    const log = new DebugLog();
    const elm = new Elm327(transport, log);
    elm.dispose();
    transport.emit('junk>');
    expect(log.entries()).toEqual([]);
  });
});

/** A responder that behaves like a typical adapter during init. */
function adapter(options: { fastRpm: boolean; adaptiveTiming: boolean }) {
  return (command: string): string => {
    if (command === 'ATZ') return 'ATZ\r\r\rELM327 v1.5\r\r>'; // echo is on right after reset
    if (command === 'ATAT2' && !options.adaptiveTiming) return '?\r\r>';
    if (command.startsWith('AT')) return 'OK\r\r>';
    if (command === '0100') return 'SEARCHING...\r4100BE3EB811\r\r>';
    if (command === '010C1') return options.fastRpm ? '410C1AF8\r\r>' : '?\r\r>';
    if (command === '010C') return '410C09B0\r410C09B0\r\r>';
    return 'NO DATA\r\r>';
  };
}

describe('init', () => {
  it('runs the init sequence in order and captures the version', async () => {
    const transport = new FakeTransport();
    transport.responder = adapter({ fastRpm: true, adaptiveTiming: true });
    const elm = new Elm327(transport);

    await elm.init();

    expect(transport.commands()).toEqual([
      'ATZ',
      'ATE0',
      'ATL0',
      'ATS0',
      'ATH0',
      'ATSP0',
      'ATAT2',
      '0100',
    ]);
    expect(elm.version).toBe('ELM327 v1.5');
  });

  it('treats an unsupported ATAT2 as non-fatal', async () => {
    const transport = new FakeTransport();
    transport.responder = adapter({ fastRpm: true, adaptiveTiming: false });
    const elm = new Elm327(transport);
    await expect(elm.init()).resolves.toBeUndefined();
    expect(transport.commands().at(-1)).toBe('0100');
  });

  it('fails when the car does not answer 0100', async () => {
    const transport = new FakeTransport();
    transport.responder = (command) =>
      command === '0100' ? 'SEARCHING...\rUNABLE TO CONNECT\r\r>' : 'OK\r\r>';
    const elm = new Elm327(transport);
    await expect(elm.init()).rejects.toBeInstanceOf(UnableToConnectError);
  });
});

describe('RPM', () => {
  it('uses 010C1 when the adapter supports it', async () => {
    const transport = new FakeTransport();
    transport.responder = adapter({ fastRpm: true, adaptiveTiming: true });
    const elm = new Elm327(transport);

    await expect(elm.detectFastRpm()).resolves.toBe('010C1');
    await expect(elm.readRpm()).resolves.toBe(1726);
    expect(transport.commands()).toEqual(['010C1', '010C1']);
  });

  it('falls back to 010C when 010C1 is rejected', async () => {
    const transport = new FakeTransport();
    transport.responder = adapter({ fastRpm: false, adaptiveTiming: true });
    const elm = new Elm327(transport);

    await expect(elm.detectFastRpm()).resolves.toBe('010C');
    await expect(elm.readRpm()).resolves.toBe(620);
    expect(transport.commands()).toEqual(['010C1', '010C']);
  });

  it('falls back to 010C when 010C1 answers without RPM', async () => {
    const transport = new FakeTransport();
    transport.responder = (command) => (command === '010C1' ? 'OK\r\r>' : '410C09B0\r\r>');
    const elm = new Elm327(transport);
    await expect(elm.detectFastRpm()).resolves.toBe('010C');
  });

  it('does not hide a disconnect during detection', async () => {
    const transport = new FakeTransport();
    transport.isConnected = false;
    const elm = new Elm327(transport);
    await expect(elm.detectFastRpm()).rejects.toBeInstanceOf(DisconnectedError);
  });

  it('readRpm returns null when the answer has no RPM', async () => {
    const transport = new FakeTransport();
    transport.responder = () => '4100BE3EB811\r\r>';
    const elm = new Elm327(transport);
    await expect(elm.readRpm()).resolves.toBeNull();
  });
});
