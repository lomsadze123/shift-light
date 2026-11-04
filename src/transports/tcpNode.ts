// Node-only: used by scripts, never bundled into the app.
import { createConnection } from 'node:net';

import type { SocketFactory, SocketLike } from './tcp';

type SocketEvent = 'connect' | 'data' | 'error' | 'close';

export const createNodeSocket: SocketFactory = (host, port) => {
  const socket = createConnection({ host, port });
  // Disable Nagle's algorithm: otherwise tiny commands like "010C\r" can sit in the kernel
  // for ~40 ms waiting to be batched with more data, adding latency to every RPM request.
  socket.setNoDelay(true);

  const adapter: SocketLike = {
    write: (data) => {
      socket.write(data);
    },
    destroy: () => {
      socket.destroy();
    },
    on: (event: SocketEvent, listener: (...args: never[]) => void) => {
      // SocketLike's overloads already pin each event to its listener type; Node's `on` can't
      // see that through a union, so widen here. Node passes a Buffer (a Uint8Array) for data.
      socket.on(event, listener as (...args: unknown[]) => void);
    },
  };
  return adapter;
};
