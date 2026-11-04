import type { Transport } from '../core/transport';

/**
 * The minimal socket surface TcpTransport needs. Node's `net.Socket` and
 * `react-native-tcp-socket` both provide it, so this file stays platform-free and the
 * platform-specific part is just a small factory (tcpNode.ts, later tcpNative.ts).
 */
export interface SocketLike {
  write(data: Uint8Array): void;
  destroy(): void;
  on(event: 'connect', listener: () => void): void;
  on(event: 'data', listener: (data: Uint8Array | string) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'close', listener: () => void): void;
}

export type SocketFactory = (host: string, port: number) => SocketLike;

export interface TcpTransportOptions {
  connectTimeoutMs?: number;
}

/**
 * ELM327 traffic is plain ASCII. Latin-1 maps every byte 0–255 to the char code with the same
 * value, so it never throws on unexpected bytes and round-trips losslessly. Done by hand
 * because `Buffer` is Node-only and `TextDecoder('latin1')` may be missing in Hermes.
 */
export function encodeLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

export function decodeLatin1(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i++) {
    text += String.fromCharCode(bytes[i]);
  }
  return text;
}

export class TcpTransport implements Transport {
  private socket: SocketLike | null = null;
  private connected = false;
  private readonly dataListeners = new Set<(chunk: string) => void>();
  private readonly closeListeners = new Set<(error?: Error) => void>();
  private closeWaiters: (() => void)[] = [];
  private readonly connectTimeoutMs: number;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly createSocket: SocketFactory,
    options: TcpTransportOptions = {},
  ) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5000;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  connect(): Promise<void> {
    if (this.socket) {
      return Promise.reject(new Error('Already connected or connecting'));
    }

    return new Promise<void>((resolve, reject) => {
      const socket = this.createSocket(this.host, this.port);
      this.socket = socket;
      let settled = false; // has connect() resolved or rejected yet?
      let lastError: Error | undefined;

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.socket = null;
        socket.destroy();
        reject(error);
      };

      const timer = setTimeout(() => {
        fail(
          new Error(
            `Connection to ${this.host}:${this.port} timed out after ${this.connectTimeoutMs} ms`,
          ),
        );
      }, this.connectTimeoutMs);

      socket.on('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.connected = true;
        resolve();
      });

      socket.on('data', (data) => {
        if (this.socket !== socket) return; // late data from an abandoned socket
        const chunk = typeof data === 'string' ? data : decodeLatin1(data);
        for (const listener of [...this.dataListeners]) listener(chunk);
      });

      socket.on('error', (error) => {
        if (!settled) {
          fail(error);
        } else {
          // Node emits 'error' and then 'close'; report the error from the close handler.
          lastError = error;
        }
      });

      socket.on('close', () => {
        const waiters = this.closeWaiters;
        this.closeWaiters = [];

        if (!settled) {
          fail(lastError ?? new Error('Connection closed before it was established'));
        } else if (this.socket === socket) {
          this.socket = null;
          this.connected = false;
          for (const listener of [...this.closeListeners]) listener(lastError);
        }

        for (const done of waiters) done();
      });
    });
  }

  disconnect(): Promise<void> {
    const socket = this.socket;
    if (!socket) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.closeWaiters.push(resolve);
      socket.destroy();
    });
  }

  async write(text: string): Promise<void> {
    if (!this.socket || !this.connected) {
      throw new Error('Not connected');
    }
    this.socket.write(encodeLatin1(text));
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
}
