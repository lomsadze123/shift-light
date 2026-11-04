import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Elm327 } from '../core/elm327';
import { TimeoutError } from '../core/elm327Errors';
import { mulberry32 } from '../core/random';
import { MockTransport, type MockTransportOptions } from './mock';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Connected mock with fixed 100 ms latency, plus a log of everything it sent back. */
async function connectedMock(options: MockTransportOptions = {}) {
  const mock = new MockTransport({
    car: { rpm: () => 1726 },
    latencyMs: 100,
    jitterMs: 0,
    random: mulberry32(1),
    ...options,
  });
  const connecting = mock.connect();
  await vi.advanceTimersByTimeAsync(50);
  await connecting;

  let received = '';
  let chunks = 0;
  mock.onData((chunk) => {
    received += chunk;
    chunks++;
  });

  /** Send a command and return everything received during the next `waitMs`. */
  const ask = async (command: string, waitMs = 500) => {
    received = '';
    chunks = 0;
    await mock.write(`${command}\r`);
    await vi.advanceTimersByTimeAsync(waitMs);
    return received;
  };

  return { mock, ask, received: () => received, chunks: () => chunks };
}

describe('MockTransport protocol', () => {
  it('connects after a short delay', async () => {
    const mock = new MockTransport();
    const connecting = mock.connect();
    expect(mock.isConnected).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    await connecting;
    expect(mock.isConnected).toBe(true);
  });

  it('echoes commands until ATE0', async () => {
    const { ask } = await connectedMock();
    expect(await ask('ATI')).toBe('ATI\rELM327 v1.5\r\r>');
    expect(await ask('ATE0')).toBe('ATE0\rOK\r\r>');
    expect(await ask('ATI')).toBe('ELM327 v1.5\r\r>');
  });

  it('turns echo back on after ATZ', async () => {
    const { ask } = await connectedMock();
    await ask('ATE0');
    expect(await ask('ATZ')).toBe('ELM327 v1.5\r\r>');
    expect(await ask('ATI')).toBe('ATI\rELM327 v1.5\r\r>');
  });

  it('prints SEARCHING... only for the first 0100', async () => {
    const { ask } = await connectedMock();
    await ask('ATE0');
    expect(await ask('0100', 1000)).toBe('SEARCHING...\r41 00 BE 3F A8 13\r\r>');
    expect(await ask('0100')).toBe('41 00 BE 3F A8 13\r\r>');
  });

  it('drops spaces after ATS0 and adds linefeeds after ATL1', async () => {
    const { ask } = await connectedMock();
    await ask('ATE0');
    await ask('ATS0');
    expect(await ask('010C')).toBe('410C1AF8\r\r>');
    await ask('ATL1');
    expect(await ask('010C1')).toBe('410C1AF8\r\n\r\n>');
  });

  it('encodes the car RPM as A B bytes', async () => {
    const { ask } = await connectedMock({ car: { rpm: () => 620 } });
    await ask('ATE0');
    expect(await ask('010C')).toBe('41 0C 09 B0\r\r>');
  });

  it('measures the car halfway through the latency', async () => {
    const readAt: number[] = [];
    const { mock } = await connectedMock({
      car: {
        rpm: () => {
          readAt.push(Date.now());
          return 1000;
        },
      },
    });
    const sentAt = Date.now();
    await mock.write('010C\r');
    await vi.advanceTimersByTimeAsync(500);
    expect(readAt).toEqual([sentAt + 50]);
  });

  it('answers nothing before the latency has passed', async () => {
    const { mock, received } = await connectedMock();
    await mock.write('ATI\r');
    await vi.advanceTimersByTimeAsync(99);
    expect(received()).toBe('');
    await vi.advanceTimersByTimeAsync(50);
    expect(received()).toContain('>');
  });

  it('delivers answers in several chunks', async () => {
    const { ask, chunks } = await connectedMock();
    await ask('0100', 1000);
    expect(chunks()).toBeGreaterThan(1);
  });

  it('handles a command split across writes', async () => {
    const { mock, received } = await connectedMock();
    await mock.write('AT');
    await mock.write('I\r');
    await vi.advanceTimersByTimeAsync(500);
    expect(received()).toBe('ATI\rELM327 v1.5\r\r>');
  });

  it('answers NO DATA for unsupported requests', async () => {
    const { ask } = await connectedMock();
    await ask('ATE0');
    expect(await ask('0105')).toBe('NO DATA\r\r>');
  });

  it('loses RPM requests at the timeout rate but never init requests', async () => {
    const { ask } = await connectedMock({ timeoutRate: 1 });
    await ask('ATE0');
    expect(await ask('010C', 5000)).toBe('');
    expect(await ask('0100', 1000)).toContain('41 00');
  });

  it('answers STOPPED when interrupted by a new command', async () => {
    const { mock, received } = await connectedMock();
    await mock.write('ATE0\r');
    await vi.advanceTimersByTimeAsync(500);

    await mock.write('010C\r');
    await vi.advanceTimersByTimeAsync(10);
    await mock.write('ATI\r');
    await vi.advanceTimersByTimeAsync(1000);
    expect(received()).toBe('ATE0\rOK\r\r>STOPPED\r\r>');
  });

  it('closes on disconnect and rejects later writes', async () => {
    const { mock, received } = await connectedMock();
    const onClose = vi.fn();
    mock.onClose(onClose);

    await mock.write('ATI\r');
    await mock.disconnect();
    await vi.advanceTimersByTimeAsync(500);

    expect(onClose).toHaveBeenCalledWith(undefined);
    expect(mock.isConnected).toBe(false);
    expect(received()).toBe(''); // the pending answer was cancelled
    await expect(mock.write('ATI\r')).rejects.toThrow('Not connected');
  });
});

describe('MockTransport with the Elm327 driver', () => {
  it('initializes, detects fast RPM and reads the car RPM', async () => {
    const mock = new MockTransport({
      car: { rpm: () => 3000 },
      random: mulberry32(3),
      timeoutRate: 0,
    });
    const connecting = mock.connect();
    await vi.advanceTimersByTimeAsync(50);
    await connecting;
    const elm = new Elm327(mock);

    const init = elm.init();
    await vi.advanceTimersByTimeAsync(5000);
    await init;
    expect(elm.version).toBe('ELM327 v1.5');

    const detect = elm.detectFastRpm();
    await vi.advanceTimersByTimeAsync(500);
    await expect(detect).resolves.toBe('010C1');

    const read = elm.readRpm();
    await vi.advanceTimersByTimeAsync(500);
    await expect(read).resolves.toBe(3000);
  });

  it('surfaces lost requests as TimeoutError', async () => {
    const mock = new MockTransport({ car: { rpm: () => 3000 }, timeoutRate: 1 });
    const connecting = mock.connect();
    await vi.advanceTimersByTimeAsync(50);
    await connecting;
    const elm = new Elm327(mock);

    const read = elm.readRpm({ timeoutMs: 1000 });
    const rejected = expect(read).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
  });
});
