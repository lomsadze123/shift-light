import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeLatin1, encodeLatin1, type SocketLike, TcpTransport } from './tcp';

/** A socket we drive by hand: tests call emitX() to simulate what the network does. */
class FakeSocket implements SocketLike {
  readonly written: Uint8Array[] = [];
  destroyCalls = 0;
  private closed = false;
  private readonly connectListeners: (() => void)[] = [];
  private readonly dataListeners: ((data: Uint8Array | string) => void)[] = [];
  private readonly errorListeners: ((error: Error) => void)[] = [];
  private readonly closeListeners: (() => void)[] = [];

  constructor(
    readonly host: string,
    readonly port: number,
  ) {}

  write(data: Uint8Array): void {
    this.written.push(data);
  }

  /** Like Node: destroy() leads to an asynchronous 'close'. */
  destroy(): void {
    this.destroyCalls++;
    queueMicrotask(() => this.emitClose());
  }

  on(event: 'connect', listener: () => void): void;
  on(event: 'data', listener: (data: Uint8Array | string) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'connect' | 'data' | 'error' | 'close', listener: (...args: never[]) => void): void {
    const lists = {
      connect: this.connectListeners,
      data: this.dataListeners,
      error: this.errorListeners,
      close: this.closeListeners,
    };
    (lists[event] as ((...args: never[]) => void)[]).push(listener);
  }

  emitConnect(): void {
    this.connectListeners.forEach((l) => l());
  }
  emitData(data: Uint8Array | string): void {
    this.dataListeners.forEach((l) => l(data));
  }
  emitError(error: Error): void {
    this.errorListeners.forEach((l) => l(error));
  }
  emitClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeListeners.forEach((l) => l());
  }
}

function setup(options?: { connectTimeoutMs?: number }) {
  const sockets: FakeSocket[] = [];
  const transport = new TcpTransport(
    'emu.local',
    35000,
    (host, port) => {
      const socket = new FakeSocket(host, port);
      sockets.push(socket);
      return socket;
    },
    options,
  );
  return { transport, sockets };
}

async function connected() {
  const ctx = setup();
  const pending = ctx.transport.connect();
  ctx.sockets[0].emitConnect();
  await pending;
  return { ...ctx, socket: ctx.sockets[0] };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('latin1 helpers', () => {
  it('round-trips ASCII control chars and high bytes', () => {
    const text = 'ATZ\r\n>' + String.fromCharCode(0x80, 0xe9, 0xff);
    expect(decodeLatin1(encodeLatin1(text))).toBe(text);
  });

  it('decodes bytes to the same char codes', () => {
    expect(decodeLatin1(new Uint8Array([0x34, 0x31, 0x0d, 0x3e]))).toBe('41\r>');
  });
});

describe('TcpTransport.connect', () => {
  it('opens a socket to host:port and resolves on connect', async () => {
    const { transport, socket } = await connected();
    expect(socket.host).toBe('emu.local');
    expect(socket.port).toBe(35000);
    expect(transport.isConnected).toBe(true);
  });

  it('rejects when the socket errors before connecting', async () => {
    const { transport, sockets } = setup();
    const pending = transport.connect();
    sockets[0].emitError(new Error('connect ECONNREFUSED'));
    await expect(pending).rejects.toThrow('ECONNREFUSED');
    expect(transport.isConnected).toBe(false);
    expect(sockets[0].destroyCalls).toBe(1);
  });

  it('rejects on timeout', async () => {
    vi.useFakeTimers();
    const { transport, sockets } = setup({ connectTimeoutMs: 1000 });
    const pending = transport.connect();
    const assertion = expect(pending).rejects.toThrow(/timed out after 1000 ms/);
    vi.advanceTimersByTime(1000);
    await assertion;
    expect(sockets[0].destroyCalls).toBe(1);
  });

  it('rejects a second connect while connected', async () => {
    const { transport } = await connected();
    await expect(transport.connect()).rejects.toThrow(/Already connected/);
  });

  it('can connect again after a failed attempt', async () => {
    const { transport, sockets } = setup();
    const first = transport.connect();
    sockets[0].emitError(new Error('nope'));
    await expect(first).rejects.toThrow('nope');

    const second = transport.connect();
    sockets[1].emitConnect();
    await second;
    expect(transport.isConnected).toBe(true);
  });
});

describe('TcpTransport data', () => {
  it('delivers string and byte chunks decoded and in order, without reframing', async () => {
    const { transport, socket } = await connected();
    const chunks: string[] = [];
    transport.onData((chunk) => chunks.push(chunk));

    socket.emitData('EL');
    socket.emitData(encodeLatin1('M327 v1.5\r\r'));
    socket.emitData('>');

    expect(chunks).toEqual(['EL', 'M327 v1.5\r\r', '>']);
  });

  it('stops delivering after unsubscribe', async () => {
    const { transport, socket } = await connected();
    const chunks: string[] = [];
    const unsubscribe = transport.onData((chunk) => chunks.push(chunk));
    socket.emitData('A');
    unsubscribe();
    socket.emitData('B');
    expect(chunks).toEqual(['A']);
  });

  it('writes text as latin1 bytes', async () => {
    const { transport, socket } = await connected();
    await transport.write('010C\r');
    expect(socket.written).toEqual([encodeLatin1('010C\r')]);
  });

  it('rejects writes when not connected', async () => {
    const { transport } = setup();
    await expect(transport.write('ATZ\r')).rejects.toThrow('Not connected');
  });
});

describe('TcpTransport close', () => {
  it('reports a remote close with the error that caused it', async () => {
    const { transport, socket } = await connected();
    const onClose = vi.fn();
    transport.onClose(onClose);

    const error = new Error('ECONNRESET');
    socket.emitError(error);
    socket.emitClose();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(error);
    expect(transport.isConnected).toBe(false);
    await expect(transport.write('ATZ\r')).rejects.toThrow('Not connected');
  });

  it('reports a clean remote close with no error', async () => {
    const { transport, socket } = await connected();
    const onClose = vi.fn();
    transport.onClose(onClose);
    socket.emitClose();
    expect(onClose).toHaveBeenCalledWith(undefined);
  });

  it('disconnect() resolves after the socket closes and notifies listeners once', async () => {
    const { transport, socket } = await connected();
    const onClose = vi.fn();
    transport.onClose(onClose);

    await transport.disconnect();

    expect(socket.destroyCalls).toBe(1);
    expect(transport.isConnected).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(undefined);
  });

  it('disconnect() is a no-op when not connected', async () => {
    const { transport, sockets } = setup();
    await transport.disconnect();
    expect(sockets).toHaveLength(0);
  });
});
